"""HTTP client for aicser-license-server's public API.

Mirrors src/modules/authentication/keycloak_service.py's httpx + module-level
cache pattern — the closest existing analog for a signed-token-issuing HTTP
dependency in this codebase.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

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
    max_users: int | None = None


def _base_url() -> str:
    return settings.LICENSE_SERVER_URL.rstrip("/")


async def _post(path: str, payload: dict) -> dict:
    url = f"{_base_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            resp = await http.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise LicenseServerError(str(exc)) from exc

    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        raise LicenseServerError(str(detail), status_code=resp.status_code)

    return resp.json()


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
            resp.raise_for_status()
            body = resp.json()
    except httpx.HTTPError as exc:
        if _PUBLIC_KEY_CACHE is not None:
            logger.warning("Failed to refresh license server public key, using cached: %s", exc)
            return _PUBLIC_KEY_CACHE
        status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        raise LicenseServerError(str(exc), status_code=status_code) from exc

    _PUBLIC_KEY_CACHE = body["public_key_pem"]
    return _PUBLIC_KEY_CACHE
