"""Unit tests for ee/modules/authentication/token_exchange.py.

Covers the gap this session fixed: the username chosen at Supabase/Keycloak
sign-up must reach the local shadow User row instead of always being
synthesized from the email prefix.
"""

import time
from uuid import uuid4

import pytest

from ee.modules.authentication.token_exchange import (
    upsert_provider_user,
    validate_keycloak_token,
    validate_supabase_token,
)


# ── validate_supabase_token: username extraction from user_metadata ──────────

def _encode_supabase_jwt(secret: str, *, sub: str, email: str, username: str | None):
    from jose import jwt as jose_jwt

    claims = {
        "sub": sub,
        "email": email,
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    if username is not None:
        claims["user_metadata"] = {"username": username}
    return jose_jwt.encode(claims, secret, algorithm="HS256")


def test_validate_supabase_token_extracts_username_from_user_metadata(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    sub = str(uuid4())
    token = _encode_supabase_jwt("test-secret", sub=sub, email="a@example.com", username="chosen_name")

    claims = validate_supabase_token(token)

    assert claims["sub"] == sub
    assert claims["email"] == "a@example.com"
    assert claims["username"] == "chosen_name"


def test_validate_supabase_token_username_absent_when_no_metadata(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    sub = str(uuid4())
    token = _encode_supabase_jwt("test-secret", sub=sub, email="a@example.com", username=None)

    claims = validate_supabase_token(token)

    assert claims.get("username") is None


# ── validate_keycloak_token: username from preferred_username ────────────────

def test_validate_keycloak_token_extracts_preferred_username(monkeypatch):
    import jwt as pyjwt
    from jwt import PyJWKClient
    from cryptography.hazmat.primitives.asymmetric import rsa

    keycloak_url = "http://keycloak.local"
    realm = "aiser"
    monkeypatch.setenv("KEYCLOAK_URL", keycloak_url)
    monkeypatch.setenv("KEYCLOAK_REALM", realm)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    sub = str(uuid4())
    token = pyjwt.encode(
        {
            "sub": sub,
            "email": "b@example.com",
            "preferred_username": "kc_user",
            "realm_access": {"roles": []},
            "iss": f"{keycloak_url}/realms/{realm}",
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    class _FakeSigningKey:
        def __init__(self, key):
            self.key = key

    monkeypatch.setattr(
        PyJWKClient,
        "get_signing_key",
        lambda self, kid: _FakeSigningKey(private_key.public_key()),
    )

    claims = validate_keycloak_token(token)

    assert claims["sub"] == sub
    assert claims["username"] == "kc_user"


# ── upsert_provider_user: username threading ──────────────────────────────────

class _FakeResult:
    def scalar_one_or_none(self):
        return None


class _FakeAsyncSession:
    def __init__(self):
        self.added = []

    async def execute(self, _stmt):
        return _FakeResult()

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def refresh(self, _obj):
        pass


@pytest.mark.asyncio
async def test_upsert_provider_user_uses_supplied_username():
    db = _FakeAsyncSession()

    user = await upsert_provider_user(
        db,
        provider="supabase",
        provider_user_id=str(uuid4()),
        email="chosen@example.com",
        username="chosen_name",
    )

    assert user.username == "chosen_name"
    assert user.provider == "supabase"


@pytest.mark.asyncio
async def test_upsert_provider_user_falls_back_to_email_prefix_when_no_username():
    db = _FakeAsyncSession()

    user = await upsert_provider_user(
        db,
        provider="supabase",
        provider_user_id=str(uuid4()),
        email="noname@example.com",
        username=None,
    )

    assert user.username == "noname"


@pytest.mark.asyncio
async def test_upsert_provider_user_falls_back_when_username_blank():
    db = _FakeAsyncSession()

    user = await upsert_provider_user(
        db,
        provider="supabase",
        provider_user_id=str(uuid4()),
        email="blank@example.com",
        username="   ",
    )

    assert user.username == "blank"
