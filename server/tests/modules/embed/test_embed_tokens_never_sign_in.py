"""An embed link sits in public web pages: it must never work as a sign-in, even when the embed
secret is configured to the same value as a sign-in secret (it was, on every environment)."""

import os

import pytest
from jose import jwt

os.environ.setdefault("AISER_EDITION", "enterprise")

SHARED = "same-secret-everywhere"


@pytest.fixture(autouse=True)
def _shared_secrets(monkeypatch):
    from src.core.config import settings

    for name in ("JWT_SECRET_KEY", "SECRET_KEY", "JWT_SECRET"):
        monkeypatch.setattr(settings, name, SHARED, raising=False)
    monkeypatch.setenv("JWT_SECRET", SHARED)
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:9")  # remote check unreachable: must not be needed


def _embed_payload():
    return {"jti": "t1", "sub": "user-1", "type": "embed", "scopes": ["chart"], "resource_id": "c1", "exp": 9999999999, "iat": 1}


def test_new_embed_tokens_use_their_own_key():
    from src.modules.embed.service import decode_embed_token, sign_embed_token

    token = sign_embed_token(_embed_payload())
    assert decode_embed_token(token)["sub"] == "user-1"
    with pytest.raises(Exception):
        jwt.decode(token, SHARED, algorithms=["HS256"])  # not verifiable with the shared secret


def test_links_made_before_the_derived_key_still_open():
    from src.modules.embed.service import decode_embed_token

    legacy = jwt.encode(_embed_payload(), SHARED, algorithm="HS256")
    assert decode_embed_token(legacy)["jti"] == "t1"


def test_session_login_refuses_embed_tokens():
    from jose import JWTError

    from src.modules.authentication.service import decode_access_token

    legacy = jwt.encode(_embed_payload(), SHARED, algorithm="HS256")
    with pytest.raises(JWTError, match="Embed tokens"):
        decode_access_token(legacy)


def test_supabase_token_exchange_refuses_embed_and_audience_less_tokens():
    from ee.modules.authentication.token_exchange import validate_supabase_token

    legacy_embed = jwt.encode(_embed_payload(), SHARED, algorithm="HS256")
    no_aud = jwt.encode({"sub": "user-1", "exp": 9999999999}, SHARED, algorithm="HS256")
    real = jwt.encode({"sub": "user-1", "aud": "authenticated", "email": "a@b.c", "exp": 9999999999}, SHARED, algorithm="HS256")

    with pytest.raises(ValueError, match="Embed tokens"):
        validate_supabase_token(legacy_embed)
    with pytest.raises(Exception):
        validate_supabase_token(no_aud)
    assert validate_supabase_token(real)["sub"] == "user-1"
