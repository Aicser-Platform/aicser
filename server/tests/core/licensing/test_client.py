# server/tests/core/licensing/test_client.py
"""Tests for the license-server HTTP client. Mocks httpx — no network, no
real license server needed for these unit tests."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.core.licensing import client, service, state as state_module, verify
from src.core.licensing.client import ActivationResult, LicenseServerError


def _mock_response(status_code: int, json_body: dict) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=json_body,
        request=httpx.Request("POST", "https://license.test/api/v1/public/activate"),
    )


def _mock_text_response(status_code: int, text: str, *, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        text=text,
        headers=headers or {},
        request=httpx.Request("POST", "https://license.test/api/v1/public/activate"),
    )


class _CommitOnlyDb:
    async def commit(self) -> None:
        pass


@pytest.mark.asyncio
async def test_activate_success():
    body = {
        "entitlement_token": "eyJ...",
        "expires_at": "2026-08-28T00:00:00+00:00",
        "license_expires_at": "2027-08-28T00:00:00+00:00",
        "max_users": 30,
    }
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_mock_response(200, body))):
        result = await client.activate(
            license_key="AICSER-ENT-AAAA-BBBB-CCCC-DDDD",
            instance_id="inst-1",
            fingerprint="fp-1",
            product_version="0.0.1",
        )
    assert isinstance(result, ActivationResult)
    assert result.entitlement_token == "eyJ..."
    assert result.expires_at == datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert result.license_expires_at == datetime(2027, 8, 28, tzinfo=timezone.utc)
    assert result.max_users == 30


@pytest.mark.asyncio
async def test_activate_rejected_key_raises():
    body = {"detail": "License key not found"}
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_mock_response(403, body))):
        with pytest.raises(LicenseServerError, match="License key not found"):
            await client.activate(
                license_key="bad-key",
                instance_id="inst-1",
                fingerprint="fp-1",
                product_version="0.0.1",
            )


@pytest.mark.asyncio
async def test_activate_redirect_raises_license_server_error():
    response = _mock_text_response(307, "", headers={"location": "/login"})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=response)):
        with pytest.raises(LicenseServerError, match="HTTP 307.*redirected to /login"):
            await client.activate(
                license_key="bad-key",
                instance_id="inst-1",
                fingerprint="fp-1",
                product_version="0.0.1",
            )


@pytest.mark.asyncio
async def test_activate_invalid_json_raises_license_server_error():
    response = _mock_text_response(200, "<html>not json</html>")
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=response)):
        with pytest.raises(LicenseServerError, match="invalid JSON"):
            await client.activate(
                license_key="bad-key",
                instance_id="inst-1",
                fingerprint="fp-1",
                product_version="0.0.1",
            )


@pytest.mark.asyncio
async def test_validate_success():
    body = {
        "entitlement_token": "eyJ...",
        "expires_at": "2026-08-28T00:00:00+00:00",
        "license_expires_at": None,
        "max_users": 30,
    }
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_mock_response(200, body))):
        result = await client.validate(license_id="lic-1", instance_id="inst-1")
    assert result.entitlement_token == "eyJ..."
    assert result.license_expires_at is None
    assert result.max_users == 30


@pytest.mark.asyncio
async def test_apply_result_uses_license_expiry_not_token_expiry():
    token_expires_at = datetime(2026, 8, 28, tzinfo=timezone.utc)
    license_expires_at = datetime(2027, 8, 28, tzinfo=timezone.utc)
    result = ActivationResult(
        entitlement_token="eyJ...",
        expires_at=token_expires_at,
        license_expires_at=license_expires_at,
    )
    row = SimpleNamespace(max_users=None)
    claims = {
        "license_id": "lic-1",
        "customer_id": "cust-1",
        "features": ["sso"],
        "exp": int(token_expires_at.timestamp()),
        "license_expires_at": license_expires_at.isoformat(),
    }

    with patch.object(verify, "verify_entitlement_token", new=AsyncMock(return_value=claims)):
        await service._apply_result(_CommitOnlyDb(), row, result)

    assert row.expires_at == license_expires_at
    assert row.expires_at != token_expires_at
    state_module.state.update(is_valid=False, features=[])


@pytest.mark.asyncio
async def test_activate_network_failure_raises_license_server_error():
    with patch(
        "httpx.AsyncClient.post",
        new=AsyncMock(side_effect=httpx.ConnectError("connection refused")),
    ):
        with pytest.raises(LicenseServerError, match="connection refused"):
            await client.activate(
                license_key="AICSER-ENT-AAAA-BBBB-CCCC-DDDD",
                instance_id="inst-1",
                fingerprint="fp-1",
                product_version="0.0.1",
            )


@pytest.mark.asyncio
async def test_fetch_public_key_success_and_cache():
    client._PUBLIC_KEY_CACHE = None  # reset module-level cache between tests
    body = {"algorithm": "EdDSA", "public_key_pem": "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n"}
    mock_get = AsyncMock(
        return_value=httpx.Response(
            200, json=body, request=httpx.Request("GET", "https://license.test/api/v1/public/keys")
        )
    )
    with patch("httpx.AsyncClient.get", new=mock_get):
        key1 = await client.fetch_public_key()
        key2 = await client.fetch_public_key()
    assert key1 == body["public_key_pem"]
    assert key2 == body["public_key_pem"]
    assert mock_get.call_count == 1  # second call served from cache


@pytest.mark.asyncio
async def test_fetch_public_key_force_refresh_bypasses_cache():
    client._PUBLIC_KEY_CACHE = "stale-key"
    body = {"algorithm": "EdDSA", "public_key_pem": "fresh-key"}
    mock_get = AsyncMock(
        return_value=httpx.Response(
            200, json=body, request=httpx.Request("GET", "https://license.test/api/v1/public/keys")
        )
    )
    with patch("httpx.AsyncClient.get", new=mock_get):
        key = await client.fetch_public_key(force_refresh=True)
    assert key == "fresh-key"
    assert mock_get.call_count == 1


@pytest.mark.asyncio
async def test_fetch_public_key_refresh_failure_falls_back_to_stale_cache():
    client._PUBLIC_KEY_CACHE = "stale-key"
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(side_effect=httpx.ConnectError("connection refused")),
    ):
        key = await client.fetch_public_key(force_refresh=True)
    assert key == "stale-key"


@pytest.mark.asyncio
async def test_fetch_public_key_failure_with_no_cache_raises():
    client._PUBLIC_KEY_CACHE = None
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(side_effect=httpx.ConnectError("connection refused")),
    ):
        with pytest.raises(LicenseServerError, match="connection refused"):
            await client.fetch_public_key()
