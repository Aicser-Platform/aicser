"""Local verification of the license server's Ed25519-signed entitlement JWTs.

No network call on the hot path: client.fetch_public_key() serves its cached
value unless this module explicitly asks for a refresh after a failure.
"""
from __future__ import annotations

import jwt

from src.core.licensing import client


class EntitlementTokenError(Exception):
    pass


async def verify_entitlement_token(token: str) -> dict:
    public_key_pem = await client.fetch_public_key()
    try:
        return jwt.decode(token, public_key_pem, algorithms=["EdDSA"])
    except jwt.PyJWTError as exc:
        # Retry once against a freshly fetched key, in case of a genuine
        # rotation the cache hasn't picked up yet.
        try:
            fresh_key = await client.fetch_public_key(force_refresh=True)
        except client.LicenseServerError as fetch_exc:
            raise EntitlementTokenError(str(exc)) from fetch_exc
        try:
            return jwt.decode(token, fresh_key, algorithms=["EdDSA"])
        except jwt.PyJWTError as retry_exc:
            raise EntitlementTokenError(str(retry_exc)) from retry_exc
