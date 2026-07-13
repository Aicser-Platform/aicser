"""Unit tests for the EE AuthManager -> ProviderFactory -> LocalProvider chain."""

import pytest

from ee.modules.auth.auth_manager import AuthManager
from src.modules.authentication.service import verify_password


class _FakeUser:
    def __init__(self, email, username, hashed_password):
        self.email = email
        self.username = username
        self.hashed_password = hashed_password
        self.provider = "local"
        self.is_verified = False


class _FakeUserRepository:
    """Stand-in for UserRepository backed by an in-memory dict, keyed by email."""

    _store: dict[str, _FakeUser] = {}

    def __init__(self, db):
        self.db = db

    async def get_by_email(self, email: str):
        return self._store.get(email.lower())

    async def save(self, user: _FakeUser):
        self._store[user.email.lower()] = user
        return user


@pytest.fixture(autouse=True)
def _clean_store():
    _FakeUserRepository._store.clear()
    yield
    _FakeUserRepository._store.clear()


@pytest.fixture(autouse=True)
def _patch_repository(monkeypatch):
    monkeypatch.setattr(
        "ee.modules.auth.services.auth_service.UserRepository", _FakeUserRepository
    )


@pytest.mark.asyncio
async def test_signup_then_login_succeeds():
    manager = AuthManager(db=None)

    user = await manager.signup("new@example.com", "newuser", "s3cret-pass")
    assert user.email == "new@example.com"

    logged_in = await manager.login("new@example.com", "s3cret-pass")
    assert logged_in is not None
    assert logged_in.email == "new@example.com"


@pytest.mark.asyncio
async def test_login_fails_with_wrong_password():
    manager = AuthManager(db=None)
    await manager.signup("user2@example.com", "user2", "correct-pass")

    result = await manager.login("user2@example.com", "wrong-pass")
    assert result is None


@pytest.mark.asyncio
async def test_login_fails_for_unknown_email():
    manager = AuthManager(db=None)
    result = await manager.login("nobody@example.com", "whatever")
    assert result is None


@pytest.mark.asyncio
async def test_signup_rejects_duplicate_email():
    manager = AuthManager(db=None)
    await manager.signup("dupe@example.com", "dupe1", "pass-one")

    with pytest.raises(ValueError):
        await manager.signup("dupe@example.com", "dupe2", "pass-two")


@pytest.mark.asyncio
async def test_signup_hash_is_verifiable_with_ce_verify_password():
    """EE's hashing was consolidated onto CE's implementation — a hash produced
    via AuthManager.signup must verify with CE's own verify_password."""
    manager = AuthManager(db=None)
    user = await manager.signup("hash-check@example.com", "hashcheck", "s3cret-pass")

    assert verify_password("s3cret-pass", user.hashed_password)
    assert not verify_password("wrong-pass", user.hashed_password)
