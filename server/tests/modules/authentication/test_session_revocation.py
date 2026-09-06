"""Regression tests for JWT session revocation.

Root cause (security audit finding): POST /auth/logout only cleared the
client-side cookie -- the JWT itself remained fully valid until its natural
7-day expiry regardless of logout, password change, or a lost/stolen device.
There was no way to invalidate a session token server-side at all.

Fixed by minting a jti (JWT id) + iat (issued-at) claim on every token
(create_access_token), and checking two Redis-backed revocation signals on
every decode (decode_access_token -> _is_revoked):
  1. a per-token deny-list entry keyed by jti (single-session revocation --
     logout), auto-expiring at the token's own natural exp so the deny-list
     never grows unbounded;
  2. a per-user "session floor" timestamp (revoke-all -- password change,
     password reset, or a user-initiated "log out everywhere"): any token
     whose iat predates the floor is rejected, while a fresh login (new iat)
     stays valid.

Tokens minted before this claim existed have no jti/iat and are deliberately
left un-revocable rather than rejected outright, so a deploy doesn't log out
every already-authenticated user.
"""

import time

import pytest
from jose import JWTError

from src.modules.authentication import service


class FakeCache:
    """Minimal in-memory stand-in for src.core.cache.RedisCache."""

    def __init__(self):
        self.store: dict[str, object] = {}

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, ttl=None):
        self.store[key] = value
        return True

    def exists(self, key):
        return key in self.store

    def delete(self, key):
        return bool(self.store.pop(key, None))


@pytest.fixture
def fake_cache(monkeypatch):
    c = FakeCache()
    monkeypatch.setattr(service, "cache", c)
    return c


def test_freshly_issued_token_decodes_fine(fake_cache):
    token = service.create_access_token("user-1", "a@example.com")
    payload = service.decode_access_token(token)
    assert payload["sub"] == "user-1"
    assert payload["jti"]
    assert payload["iat"]


def test_logout_revokes_the_token_immediately(fake_cache):
    token = service.create_access_token("user-1", "a@example.com")
    service.revoke_access_token(token)

    with pytest.raises(JWTError):
        service.decode_access_token(token)


def test_revoking_one_token_does_not_affect_a_sibling_session(fake_cache):
    """Logging out on one device must not log out other devices — only
    revoke_all_sessions_for_user does that."""
    token_a = service.create_access_token("user-1", "a@example.com")
    time.sleep(1.05)  # cross a whole-second boundary — iat/exp round-trip at second granularity
    token_b = service.create_access_token("user-1", "a@example.com")

    service.revoke_access_token(token_a)

    with pytest.raises(JWTError):
        service.decode_access_token(token_a)
    # Sibling session survives.
    assert service.decode_access_token(token_b)["sub"] == "user-1"


def test_revoke_all_sessions_invalidates_previously_issued_tokens(fake_cache):
    old_token = service.create_access_token("user-1", "a@example.com")
    time.sleep(1.05)  # cross a whole-second boundary — iat/exp round-trip at second granularity

    service.revoke_all_sessions_for_user("user-1")

    with pytest.raises(JWTError):
        service.decode_access_token(old_token)


def test_revoke_all_sessions_does_not_block_a_fresh_login(fake_cache):
    """A user who revokes all sessions and logs back in must not be
    immediately logged out again by their own floor."""
    service.revoke_all_sessions_for_user("user-1")
    time.sleep(1.05)  # cross a whole-second boundary — iat/exp round-trip at second granularity
    new_token = service.create_access_token("user-1", "a@example.com")

    payload = service.decode_access_token(new_token)
    assert payload["sub"] == "user-1"


def test_revoke_all_sessions_does_not_affect_other_users(fake_cache):
    other_user_token = service.create_access_token("user-2", "b@example.com")
    time.sleep(1.05)  # cross a whole-second boundary — iat/exp round-trip at second granularity

    service.revoke_all_sessions_for_user("user-1")

    assert service.decode_access_token(other_user_token)["sub"] == "user-2"


def test_token_without_jti_is_not_revocable_but_still_valid(fake_cache):
    """Pre-existing tokens minted before this feature shipped have no jti/iat
    claim — decode must still succeed (no forced mass-logout on deploy)."""
    from jose import jwt as jose_jwt
    from datetime import datetime, timedelta, timezone
    from src.core.config import settings

    legacy_payload = {
        "sub": "user-legacy",
        "email": "legacy@example.com",
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    legacy_token = jose_jwt.encode(legacy_payload, settings.SECRET_KEY, algorithm=service.ALGORITHM)

    payload = service.decode_access_token(legacy_token)
    assert payload["sub"] == "user-legacy"


def test_revoke_access_token_on_garbage_input_is_a_safe_no_op(fake_cache):
    service.revoke_access_token("not-a-real-token")  # must not raise


def test_decode_without_cache_available_skips_revocation_check(monkeypatch):
    """If Redis is unreachable, RedisCache degrades to its own fallback --
    but if `cache` itself is None, decode must still work (fail open on the
    revocation check, not on auth entirely)."""
    monkeypatch.setattr(service, "cache", None)
    token = service.create_access_token("user-1", "a@example.com")
    payload = service.decode_access_token(token)
    assert payload["sub"] == "user-1"
