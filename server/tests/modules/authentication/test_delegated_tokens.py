"""Delegated agent tokens: scoped to one run, short-lived, revocable, never a sign-in."""

import pytest
from jose import JWTError

from src.modules.authentication import delegated as D
from src.modules.authentication.service import decode_access_token


class _Cache:
    def __init__(self):
        self.d = {}

    def set(self, k, v, ttl=None):
        self.d[k] = v
        return True

    def exists(self, k):
        return k in self.d

    def get(self, k):
        return self.d.get(k)


@pytest.fixture()
def cache(monkeypatch):
    c = _Cache()
    monkeypatch.setattr(D, "cache", c)
    import src.modules.authentication.service as S

    monkeypatch.setattr(S, "cache", c)
    return c


def _mint(**kw):
    return D.mint_delegated_token(user_id="u1", organization_id="o1", run_id="r1",
                                  scopes=kw.pop("scopes", ["data:read", "agent:device"]), **kw)


def test_token_carries_person_run_and_scopes(cache):
    p = D.decode_delegated_token(_mint(), required_scopes=["data:read"])
    assert p["sub"] == "u1" and p["act"] == {"sub": "aicser-agent", "run": "r1"}
    assert D.token_scopes(p) == ["agent:device", "data:read"]


def test_missing_scope_is_refused(cache):
    with pytest.raises(JWTError):
        D.decode_delegated_token(_mint(scopes=["data:read"]), required_scopes=["email:send"])


def test_revoking_the_run_revokes_its_tokens(cache):
    token = _mint()
    D.revoke_run_tokens("r1")
    with pytest.raises(JWTError):
        D.decode_delegated_token(token)


def test_delegated_token_cannot_sign_in(cache):
    with pytest.raises(JWTError):
        decode_access_token(_mint())


def test_a_scope_is_required_and_ttl_is_capped(cache):
    with pytest.raises(ValueError):
        D.mint_delegated_token(user_id="u1", organization_id=None, run_id="r1", scopes=[])
    from jose import jwt

    from src.core.config import settings

    p = jwt.get_unverified_claims(_mint(ttl_seconds=10 ** 9))
    assert p["exp"] - p["iat"] <= D.MAX_TTL_SECONDS
