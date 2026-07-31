"""Tests for local entitlement-JWT verification. Generates a real Ed25519
keypair in-test rather than mocking jwt.decode, so the test exercises PyJWT's
actual EdDSA verification path."""
import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from src.core.licensing import client, verify
from src.core.licensing.verify import EntitlementTokenError


def _keypair_pems() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


def _sign(private_pem: str, **claim_overrides) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    claims = {
        "license_id": "lic-1",
        "customer_id": "cust-1",
        "edition": "enterprise",
        "features": ["sso"],
        "instance_id": "inst-1",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(days=30)).timestamp()),
        **claim_overrides,
    }
    return jwt.encode(claims, private_pem, algorithm="EdDSA")


@pytest.mark.asyncio
async def test_verify_valid_token_returns_claims(monkeypatch):
    private_pem, public_pem = _keypair_pems()
    token = _sign(private_pem)
    monkeypatch.setattr(client, "fetch_public_key", lambda **_: public_pem)

    async def _fake_fetch(**_):
        return public_pem

    monkeypatch.setattr(client, "fetch_public_key", _fake_fetch)

    claims = await verify.verify_entitlement_token(token)
    assert claims["license_id"] == "lic-1"
    assert claims["customer_id"] == "cust-1"
    assert claims["features"] == ["sso"]


@pytest.mark.asyncio
async def test_verify_wrong_key_raises(monkeypatch):
    private_pem, _real_public_pem = _keypair_pems()
    _other_private_pem, other_public_pem = _keypair_pems()
    token = _sign(private_pem)

    async def _fake_fetch(**_):
        return other_public_pem

    monkeypatch.setattr(client, "fetch_public_key", _fake_fetch)

    with pytest.raises(EntitlementTokenError):
        await verify.verify_entitlement_token(token)


@pytest.mark.asyncio
async def test_verify_expired_token_raises(monkeypatch):
    private_pem, public_pem = _keypair_pems()
    now = dt.datetime.now(dt.timezone.utc)
    token = _sign(private_pem, exp=int((now - dt.timedelta(days=1)).timestamp()))

    async def _fake_fetch(**_):
        return public_pem

    monkeypatch.setattr(client, "fetch_public_key", _fake_fetch)

    with pytest.raises(EntitlementTokenError, match="expired"):
        await verify.verify_entitlement_token(token)
