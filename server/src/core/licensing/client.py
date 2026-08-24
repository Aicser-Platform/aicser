"""HTTP client for aicser-license-server's public API.

Mirrors src/modules/authentication/keycloak_service.py's httpx + module-level
cache pattern — the closest existing analog for a signed-token-issuing HTTP
dependency in this codebase.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from src.core.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0

_PUBLIC_KEY_CACHE: str | None = None


class LicenseServerError(Exception):
    """Raised for any non-2xx response or network failure talking to the license server."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ActivationResult:
    entitlement_token: str
    expires_at: datetime
    license_expires_at: datetime | None = None
    max_users: int | None = None


def _base_url() -> str:
    return settings.LICENSE_SERVER_URL.rstrip("/")


def _parse_optional_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _response_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        body_text = resp.text.strip()
        detail = body_text or resp.reason_phrase
    else:
        if isinstance(body, dict):
            detail = str(body.get("detail") or body.get("error") or body.get("message") or body)
        else:
            detail = str(body)

    location = resp.headers.get("location")
    if 300 <= resp.status_code < 400 and location:
        return f"{detail} (redirected to {location})"
    return detail


def _json_response(resp: httpx.Response, *, endpoint: str) -> dict[str, Any]:
    if resp.status_code >= 300:
        raise LicenseServerError(
            f"License server returned HTTP {resp.status_code} for {endpoint}: {_response_detail(resp)}",
            status_code=resp.status_code,
        )

    try:
        body = resp.json()
    except ValueError as exc:
        detail = resp.text.strip() or resp.reason_phrase
        raise LicenseServerError(
            f"License server returned invalid JSON for {endpoint}: {detail}",
            status_code=resp.status_code,
        ) from exc

    if not isinstance(body, dict):
        raise LicenseServerError(
            f"License server returned unexpected JSON for {endpoint}: {type(body).__name__}",
            status_code=resp.status_code,
        )
    return body


async def _post(path: str, payload: dict) -> dict:
    url = f"{_base_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            resp = await http.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise LicenseServerError(str(exc)) from exc

    return _json_response(resp, endpoint=path)


async def activate(
    *, license_key: str, instance_id: str, fingerprint: str, product_version: str
) -> ActivationResult:
    """POST /api/v1/public/activate — first-time activation for this instance."""
    body = await _post(
        "/api/v1/public/activate",
        {
            "license_key": license_key,
            "instance_id": instance_id,
            "fingerprint": fingerprint,
            "product_version": product_version,
        },
    )
    return ActivationResult(
        entitlement_token=body["entitlement_token"],
        expires_at=datetime.fromisoformat(body["expires_at"]),
        license_expires_at=_parse_optional_datetime(body.get("license_expires_at")),
        max_users=body.get("max_users"),
    )


async def validate(*, license_id: str, instance_id: str) -> ActivationResult:
    """POST /api/v1/public/validate — re-validation for an already-activated instance."""
    body = await _post(
        "/api/v1/public/validate",
        {"license_id": license_id, "instance_id": instance_id},
    )
    return ActivationResult(
        entitlement_token=body["entitlement_token"],
        expires_at=datetime.fromisoformat(body["expires_at"]),
        license_expires_at=_parse_optional_datetime(body.get("license_expires_at")),
        max_users=body.get("max_users"),
    )


async def fetch_public_key(*, force_refresh: bool = False) -> str:
    """GET /api/v1/public/keys — cached in-process; re-fetched only on demand
    (verify.py calls with force_refresh=True after a verification failure, in
    case of a genuine key rotation)."""
    global _PUBLIC_KEY_CACHE

    if _PUBLIC_KEY_CACHE is not None and not force_refresh:
        return _PUBLIC_KEY_CACHE

    url = f"{_base_url()}/api/v1/public/keys"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            resp = await http.get(url)
            body = _json_response(resp, endpoint="/api/v1/public/keys")
    except httpx.HTTPError as exc:
        if _PUBLIC_KEY_CACHE is not None:
            logger.warning("Failed to refresh license server public key, using cached: %s", exc)
            return _PUBLIC_KEY_CACHE
        status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        raise LicenseServerError(str(exc), status_code=status_code) from exc
    except LicenseServerError as exc:
        if _PUBLIC_KEY_CACHE is not None:
            logger.warning("Failed to refresh license server public key, using cached: %s", exc)
            return _PUBLIC_KEY_CACHE
        raise

    _PUBLIC_KEY_CACHE = body["public_key_pem"]
    return _PUBLIC_KEY_CACHE
