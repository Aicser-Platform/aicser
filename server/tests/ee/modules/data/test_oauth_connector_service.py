"""Regression tests for the CRM/ERP OAuth2 delegated-flow connector (Phase 0).

Tenant isolation and CSRF-state validity are the two things that matter most
here -- everything else (token exchange, refresh) is fairly standard OAuth2
client plumbing that's easy to get right and hard to get interestingly wrong.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from ee.modules.data.services import oauth_connector_service as svc
from src.modules.data.models import OAuthConnectorConnection


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: self._value)


class _FakeSession:
    """Records every statement passed to execute() so tests can assert on
    the compiled SQL's bound parameters -- proves tenant-scoping predicates
    are actually present without needing a live database."""

    def __init__(self, execute_result=None):
        self.added = []
        self.committed = False
        self.executed_statements = []
        self._execute_result = execute_result

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        pass

    async def execute(self, stmt):
        self.executed_statements.append(stmt)
        return self._execute_result if self._execute_result is not None else _FakeResult(None)


class _FakeCache:
    def __init__(self):
        self.store = {}

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, ttl=None):
        self.store[key] = value
        return True

    def delete(self, key):
        self.store.pop(key, None)
        return True


def _compiled_sql(stmt) -> str:
    from sqlalchemy.dialects import postgresql

    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def _make_connection(**overrides):
    from src.modules.data.utils.credentials import encrypt_credentials

    defaults = dict(
        id=uuid4(),
        organization_id=str(uuid4()),
        project_id=None,
        vendor="salesforce",
        name="Salesforce Production",
        connected_by_user_id=str(uuid4()),
        client_id="cid",
        client_secret=encrypt_credentials({"client_secret": "shh"})["client_secret"],
        redirect_uri="https://aiser.example.com/callback",
        access_token=None,
        refresh_token=None,
        token_expires_at=None,
        instance_url=None,
        scopes=["api", "refresh_token"],
        is_sandbox=False,
        status="pending",
        last_error=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# Tenant isolation: the query itself must filter by organization_id
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_connection_query_filters_by_both_id_and_organization_id():
    connection_id = str(uuid4())
    organization_id = str(uuid4())
    session = _FakeSession(execute_result=_FakeResult(None))

    await svc._get_connection(session, connection_id=connection_id, organization_id=organization_id)

    assert len(session.executed_statements) == 1
    sql = _compiled_sql(session.executed_statements[0])
    assert connection_id in sql
    assert organization_id in sql


@pytest.mark.asyncio
async def test_list_connections_query_filters_by_organization_id():
    organization_id = str(uuid4())
    session = _FakeSession(execute_result=_FakeResult([]))

    await svc.list_connections(session, organization_id=organization_id)

    sql = _compiled_sql(session.executed_statements[0])
    assert organization_id in sql


# ---------------------------------------------------------------------------
# create_pending_connection: client_secret must never be stored in plaintext
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_pending_connection_encrypts_client_secret():
    session = _FakeSession()
    connection = await svc.create_pending_connection(
        session,
        organization_id=str(uuid4()),
        project_id=None,
        connected_by_user_id=str(uuid4()),
        vendor="salesforce",
        name="Salesforce Production",
        client_id="cid",
        client_secret="super-secret-value",
        redirect_uri="https://aiser.example.com/callback",
    )
    assert connection.client_secret != "super-secret-value"
    assert connection.status == "pending"
    assert session.committed is True


@pytest.mark.asyncio
async def test_create_pending_connection_rejects_unsupported_vendor():
    session = _FakeSession()
    with pytest.raises(svc.OAuthConnectorError):
        await svc.create_pending_connection(
            session,
            organization_id=str(uuid4()),
            project_id=None,
            connected_by_user_id=str(uuid4()),
            vendor="not-a-real-crm",
            name="x",
            client_id="cid",
            client_secret="secret",
            redirect_uri="https://aiser.example.com/callback",
        )


# ---------------------------------------------------------------------------
# build_authorize_url / complete_authorization: CSRF state
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_authorize_url_uses_sandbox_host_when_flagged():
    connection = _make_connection(is_sandbox=True)
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()

    url = await svc.build_authorize_url(
        session, cache, connection_id=str(connection.id), organization_id=connection.organization_id
    )
    assert url.startswith("https://test.salesforce.com/services/oauth2/authorize")
    assert len(cache.store) == 1  # one CSRF state token stored


@pytest.mark.asyncio
async def test_build_authorize_url_uses_production_host_by_default():
    connection = _make_connection(is_sandbox=False)
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()

    url = await svc.build_authorize_url(
        session, cache, connection_id=str(connection.id), organization_id=connection.organization_id
    )
    assert url.startswith("https://login.salesforce.com/services/oauth2/authorize")


@pytest.mark.asyncio
async def test_complete_authorization_rejects_unknown_state():
    session = _FakeSession()
    cache = _FakeCache()  # empty -- no state was ever issued

    with pytest.raises(svc.OAuthConnectorError, match="Invalid or expired"):
        await svc.complete_authorization(session, cache, vendor="salesforce", code="abc", state="forged-state")


@pytest.mark.asyncio
async def test_complete_authorization_state_is_single_use():
    connection = _make_connection()
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()
    cache.store["oauth_connector_state:real-state"] = {
        "connection_id": str(connection.id),
        "organization_id": connection.organization_id,
    }

    fake_token_resp = SimpleNamespace(
        status_code=200,
        text="",
        json=lambda: {"access_token": "at", "refresh_token": "rt", "expires_in": 3600, "instance_url": "https://na1.salesforce.com"},
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_token_resp)):
        await svc.complete_authorization(session, cache, vendor="salesforce", code="abc", state="real-state")

    # State must be consumed -- a replayed callback with the same state must fail.
    with pytest.raises(svc.OAuthConnectorError, match="Invalid or expired"):
        await svc.complete_authorization(session, cache, vendor="salesforce", code="abc", state="real-state")


@pytest.mark.asyncio
async def test_complete_authorization_rejects_vendor_mismatch():
    """A state issued for a Salesforce connection must not complete against
    a /hubspot/callback URL (or vice versa) even if somehow presented."""
    connection = _make_connection(vendor="salesforce")
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()
    cache.store["oauth_connector_state:real-state"] = {
        "connection_id": str(connection.id),
        "organization_id": connection.organization_id,
    }

    with pytest.raises(svc.OAuthConnectorError, match="Vendor mismatch"):
        await svc.complete_authorization(session, cache, vendor="hubspot", code="abc", state="real-state")


@pytest.mark.asyncio
async def test_complete_authorization_persists_tokens_and_activates():
    connection = _make_connection()
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()
    cache.store["oauth_connector_state:real-state"] = {
        "connection_id": str(connection.id),
        "organization_id": connection.organization_id,
    }

    fake_token_resp = SimpleNamespace(
        status_code=200,
        text="",
        json=lambda: {"access_token": "at-123", "refresh_token": "rt-456", "expires_in": 3600, "instance_url": "https://na1.salesforce.com"},
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_token_resp)):
        result = await svc.complete_authorization(session, cache, vendor="salesforce", code="abc", state="real-state")

    assert result.status == "active"
    assert result.instance_url == "https://na1.salesforce.com"
    assert result.access_token != "at-123"  # encrypted, not plaintext
    assert result.refresh_token != "rt-456"


@pytest.mark.asyncio
async def test_complete_authorization_marks_error_on_failed_exchange():
    connection = _make_connection()
    session = _FakeSession(execute_result=_FakeResult(connection))
    cache = _FakeCache()
    cache.store["oauth_connector_state:real-state"] = {
        "connection_id": str(connection.id),
        "organization_id": connection.organization_id,
    }

    fake_resp = SimpleNamespace(status_code=400, text="invalid_grant", json=lambda: {})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        with pytest.raises(svc.OAuthConnectorError):
            await svc.complete_authorization(session, cache, vendor="salesforce", code="bad", state="real-state")

    assert connection.status == "error"
    assert connection.last_error is not None


# ---------------------------------------------------------------------------
# get_valid_access_token: refresh-before-expiry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_valid_access_token_does_not_refresh_when_far_from_expiry():
    from src.modules.data.utils.credentials import encrypt_credentials

    connection = _make_connection(
        status="active",
        access_token=encrypt_credentials({"access_token": "still-good"})["access_token"],
        instance_url="https://na1.salesforce.com",
        token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    session = _FakeSession(execute_result=_FakeResult(connection))

    with patch("httpx.AsyncClient.post", new=AsyncMock()) as mock_post:
        token, instance_url = await svc.get_valid_access_token(
            session, connection_id=str(connection.id), organization_id=connection.organization_id
        )

    mock_post.assert_not_called()
    assert token == "still-good"
    assert instance_url == "https://na1.salesforce.com"


@pytest.mark.asyncio
async def test_get_valid_access_token_refreshes_when_near_expiry():
    from src.modules.data.utils.credentials import encrypt_credentials

    connection = _make_connection(
        status="active",
        access_token=encrypt_credentials({"access_token": "stale"})["access_token"],
        refresh_token=encrypt_credentials({"refresh_token": "my-refresh-token"})["refresh_token"],
        instance_url="https://na1.salesforce.com",
        token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=10),  # inside the refresh skew window
    )
    session = _FakeSession(execute_result=_FakeResult(connection))

    fake_resp = SimpleNamespace(
        status_code=200,
        text="",
        json=lambda: {"access_token": "fresh-token", "expires_in": 3600, "instance_url": "https://na1.salesforce.com"},
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        token, _ = await svc.get_valid_access_token(
            session, connection_id=str(connection.id), organization_id=connection.organization_id
        )

    assert token == "fresh-token"


@pytest.mark.asyncio
async def test_get_valid_access_token_raises_for_inactive_connection():
    connection = _make_connection(status="revoked")
    session = _FakeSession(execute_result=_FakeResult(connection))

    with pytest.raises(svc.OAuthConnectorError):
        await svc.get_valid_access_token(
            session, connection_id=str(connection.id), organization_id=connection.organization_id
        )


# ---------------------------------------------------------------------------
# revoke_connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revoke_connection_clears_tokens():
    from src.modules.data.utils.credentials import encrypt_credentials

    connection = _make_connection(
        status="active",
        access_token=encrypt_credentials({"access_token": "at"})["access_token"],
        refresh_token=encrypt_credentials({"refresh_token": "rt"})["refresh_token"],
    )
    session = _FakeSession(execute_result=_FakeResult(connection))

    with patch("httpx.AsyncClient.post", new=AsyncMock()):
        await svc.revoke_connection(session, connection_id=str(connection.id), organization_id=connection.organization_id)

    assert connection.status == "revoked"
    assert connection.access_token is None
    assert connection.refresh_token is None


@pytest.mark.asyncio
async def test_revoke_connection_succeeds_even_if_vendor_revoke_call_fails():
    from src.modules.data.utils.credentials import encrypt_credentials

    connection = _make_connection(
        status="active",
        access_token=encrypt_credentials({"access_token": "at"})["access_token"],
    )
    session = _FakeSession(execute_result=_FakeResult(connection))

    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=Exception("network down"))):
        await svc.revoke_connection(session, connection_id=str(connection.id), organization_id=connection.organization_id)

    assert connection.status == "revoked"
