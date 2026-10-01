from jose import jwt

from src.modules.authentication import service


class _Cache:
    def __init__(self):
        self.store = {}

    def set(self, key, value, ttl=None):
        self.store[key] = value

    def get(self, key):
        return self.store.get(key)

    def exists(self, key):
        return key in self.store


def test_sso_token_can_be_revoked_and_is_then_refused(monkeypatch):
    cache = _Cache()
    monkeypatch.setattr(service, "cache", cache)
    # Signed by the identity provider, not by us.
    token = jwt.encode({"sub": "sso-user", "jti": "abc", "exp": 4102444800}, "provider-secret", algorithm="HS256")
    service.revoke_access_token(token)
    assert service.is_session_revoked({"id": "u1", "jti": "abc", "iat": 1})


def test_sign_out_everywhere_covers_sso_payloads(monkeypatch):
    cache = _Cache()
    monkeypatch.setattr(service, "cache", cache)
    service.revoke_all_sessions_for_user("u1")
    assert service.is_session_revoked({"id": "u1", "iat": 1})
    assert not service.is_session_revoked({"id": "u2", "iat": 1})
