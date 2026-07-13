"""Unit tests for the CE auth provider + registry (src/modules/authentication/provider.py).

These must pass with the ee package entirely absent — CE owns this interface
and defaults to it; EE only overrides it via register_auth_provider() when enabled.
"""

import pytest

from src.modules.authentication import provider as provider_module
from src.modules.authentication.provider import (
    CEAuthProvider,
    get_auth_provider,
    register_auth_provider,
)


@pytest.fixture(autouse=True)
def _restore_default_provider():
    """The registry is process-global state; don't let one test's override leak into another."""
    original = provider_module._active_provider
    yield
    provider_module._active_provider = original


def test_default_provider_is_ce():
    assert isinstance(get_auth_provider(), CEAuthProvider)


@pytest.mark.asyncio
async def test_ce_provider_authenticate_delegates_to_service(monkeypatch):
    calls = {}

    async def _fake_authenticate_user(db, email, password):
        calls["args"] = (db, email, password)
        return "the-user"

    monkeypatch.setattr(provider_module, "authenticate_user", _fake_authenticate_user)

    result = await CEAuthProvider().authenticate("db", "user@example.com", "pw")

    assert result == "the-user"
    assert calls["args"] == ("db", "user@example.com", "pw")


@pytest.mark.asyncio
async def test_ce_provider_register_delegates_to_service(monkeypatch):
    calls = {}

    async def _fake_register_user(db, email, username, password):
        calls["args"] = (db, email, username, password)
        return "new-user"

    monkeypatch.setattr(provider_module, "register_user", _fake_register_user)

    result = await CEAuthProvider().register("db", "user@example.com", "user", "pw")

    assert result == "new-user"
    assert calls["args"] == ("db", "user@example.com", "user", "pw")


@pytest.mark.asyncio
async def test_register_auth_provider_overrides_active_provider():
    class _FakeProvider:
        async def authenticate(self, db, email, password):
            return "fake-authenticated"

        async def register(self, db, email, username, password):
            return "fake-registered"

    fake = _FakeProvider()
    register_auth_provider(fake)

    active = get_auth_provider()
    assert active is fake
    assert await active.authenticate("db", "a@b.com", "pw") == "fake-authenticated"
