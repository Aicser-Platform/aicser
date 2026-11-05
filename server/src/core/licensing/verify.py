"""Local verification of the license server's Ed25519-signed entitlement JWTs.

No network call on the hot path: client.fetch_public_key() serves its cached
value unless this module explicitly asks for a refresh after a failure.
"""
from __future__ import annotations

import jwt

from src.core.licensing import client


# Baked into distributed images at build time (Dockerfile.prod LICENSE_PUBLIC_KEY_B64). Deliberately a
# fixed path and never an environment variable: whoever chooses the key can sign their own license.
PUBLIC_KEY_PATH = "/app/license_public_key.pem"


class EntitlementTokenError(Exception):
    pass


def verify_license_file(token: str, instance_id: str) -> dict:
    """Check an offline license file. Needs no network, which is the point of it."""
    try:
        with open(PUBLIC_KEY_PATH, encoding="utf-8") as handle:
            public_key = handle.read()
    except OSError as exc:
        raise EntitlementTokenError("This image can't verify offline licenses.") from exc
    try:
        claims = jwt.decode(token.strip(), public_key, algorithms=["EdDSA"])
    except jwt.PyJWTError as exc:
        raise EntitlementTokenError(str(exc)) from exc
    if claims.get("offline") is not True:
        raise EntitlementTokenError("This is not an offline license.")
    if claims.get("instance_id") not in ("*", instance_id):
        raise EntitlementTokenError("This license file is for another installation.")
    return claims


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
