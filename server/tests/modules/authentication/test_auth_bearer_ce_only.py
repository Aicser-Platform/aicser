"""CE must authenticate only against the local database session (auth_token JWT).

Keycloak and Supabase verification paths in auth_bearer.py exist for EE and must
never be reachable when the platform is running as Community Edition, even if
KEYCLOAK_URL / SUPABASE_URL happen to be set in the environment.
"""
from urllib.parse import quote

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.core.config import settings
from src.modules.authentication import keycloak_service
from src.modules.authentication.deps import auth_bearer


def make_request(headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "headers": raw_headers,
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def _clean_edition_env(monkeypatch):
    monkeypatch.delenv("AISER_EDITION", raising=False)
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)


def test_verify_supabase_token_ignores_keycloak_in_ce(monkeypatch):
    """A token that Keycloak would happily verify must not authenticate a CE request."""
    monkeypatch.setattr(keycloak_service, "is_keycloak_enabled", lambda: True)
    monkeypatch.setattr(
        keycloak_service,
        "verify_keycloak_token_sync",
        lambda token: {"id": "kc-user", "user_id": "kc-user", "sub": "kc-user"},
    )
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "JWT_SECRET", "your-jwt-secret-here")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    result = auth_bearer.verify_supabase_token("fake-keycloak-token")

    assert result == {}


def test_verify_supabase_token_uses_keycloak_in_ee(monkeypatch):
    """Sanity check: the same Keycloak path is still live for EE."""
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setattr(keycloak_service, "is_keycloak_enabled", lambda: True)
    monkeypatch.setattr(
        keycloak_service,
        "verify_keycloak_token_sync",
        lambda token: {"id": "kc-user", "user_id": "kc-user", "sub": "kc-user"},
    )
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "JWT_SECRET", "your-jwt-secret-here")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    result = auth_bearer.verify_supabase_token("fake-keycloak-token")

    assert result.get("id") == "kc-user"


def test_verify_supabase_token_skips_supabase_jwks_in_ce(monkeypatch):
    """Supabase JWKS verification must not even be attempted for a CE request."""
    calls = []
    monkeypatch.setattr(
        auth_bearer,
        "_should_try_supabase_jwks",
        lambda token, url: calls.append((token, url)) or True,
    )
    monkeypatch.setattr(keycloak_service, "is_keycloak_enabled", lambda: False)
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "JWT_SECRET", "your-jwt-secret-here")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    result = auth_bearer.verify_supabase_token("some.fake.token")

    assert calls == []
    assert result == {}


@pytest.mark.asyncio
async def test_jwtcookiebearer_ignores_keycloak_in_ce(monkeypatch):
    """A Keycloak-issued bearer token must not authenticate a CE request via CookieDep."""
    monkeypatch.setattr(keycloak_service, "is_keycloak_enabled", lambda: True)

    async def fake_verify_keycloak_token(token):
        return {"id": "kc-user", "user_id": "kc-user", "sub": "kc-user"}

    monkeypatch.setattr(keycloak_service, "verify_keycloak_token", fake_verify_keycloak_token)
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "JWT_SECRET", "your-jwt-secret-here")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    request = make_request(headers={"Authorization": "Bearer not-a-real-local-jwt-token"})
    bearer = auth_bearer.JWTCookieBearer(auto_error=False)

    with pytest.raises(HTTPException) as exc_info:
        await bearer(request)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_jwtcookiebearer_ignores_supabase_ssr_cookie_in_ce(monkeypatch):
    """A raw Supabase SSR session cookie must not authenticate a CE request via CookieDep."""
    monkeypatch.setattr(keycloak_service, "is_keycloak_enabled", lambda: False)
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "JWT_SECRET", "your-jwt-secret-here")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    calls = []
    monkeypatch.setattr(
        auth_bearer,
        "_jwt_from_supabase_auth_cookies",
        lambda request: calls.append(request) or "sb-raw-token",
    )

    cookie_value = quote('{"access_token": "sb-raw-token"}')
    request = make_request(headers={"Cookie": f"sb-project-auth-token={cookie_value}"})
    bearer = auth_bearer.JWTCookieBearer(auto_error=False)

    with pytest.raises(HTTPException) as exc_info:
        await bearer(request)

    assert exc_info.value.status_code == 401
    assert calls == []
