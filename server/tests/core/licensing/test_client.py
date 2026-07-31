# server/tests/core/licensing/test_client.py
"""Tests for the license-server HTTP client. Mocks httpx — no network, no
real license server needed for these unit tests."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.core.licensing import client
from src.core.licensing.client import ActivationResult, LicenseServerError


def _mock_response(status_code: int, json_body: dict) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=json_body,
        request=httpx.Request("POST", "https://license.test/api/v1/public/activate"),
    )


@pytest.mark.asyncio
async def test_activate_success():
    body = {
        "entitlement_token": "eyJ...",
        "expires_at": "2026-08-28T00:00:00+00:00",
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
async def test_validate_success():
    body = {
        "entitlement_token": "eyJ...",
        "expires_at": "2026-08-28T00:00:00+00:00",
        "max_users": 30,
    }
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_mock_response(200, body))):
        result = await client.validate(license_id="lic-1", instance_id="inst-1")
    assert result.entitlement_token == "eyJ..."
    assert result.max_users == 30


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
