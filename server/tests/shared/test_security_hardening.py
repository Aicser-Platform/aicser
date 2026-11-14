"""Regression tests for the Nov 2026 security review (one test group per finding)."""

import inspect
import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("AISER_EDITION", "enterprise")

import src.core.edition  # noqa: E402,F401  installs the src.enterprise.* alias


@pytest.fixture(autouse=True)
def saas(monkeypatch):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    monkeypatch.delenv("AISER_ALLOW_PRIVATE_DATASOURCE_HOSTS", raising=False)


# ── 1. Unauthenticated query-snapshot cleanup is gone ───────────────────────

def test_snapshot_cleanup_endpoints_removed():
    from src.modules.queries.router import router

    paths = {getattr(r, "path", "") for r in router.routes}
    assert not any(p.endswith("/snapshots/cleanup") or p.endswith("/snapshots/cleanup/schedule") for p in paths)


# ── 2. Warehouse SQL cannot reach other databases, files or secrets ──────────

@pytest.mark.parametrize("sql", [
    "SELECT * FROM postgres_scan('host=postgres user=postgres dbname=railway', 'public', 'users')",
    "SELECT postgres_query('x', 'select 1') AS q FROM orders",
    "SELECT * FROM sqlite_scan('/app/data/x.db', 't')",
    "SELECT * FROM duckdb_secrets()",
    "SELECT * FROM mysql_scan('host=10.0.0.1', 'db', 't')",
])
def test_warehouse_refuses_scanners_and_secrets(sql):
    from src.modules.warehouse.engine import WarehouseError, referenced_tables

    with pytest.raises(WarehouseError):
        referenced_tables(sql)


def test_warehouse_still_reads_gold_tables():
    from src.modules.warehouse.engine import referenced_tables

    assert referenced_tables("SELECT region, sum(amount) FROM orders GROUP BY 1") == ["orders"]


# ── 4. Org member list needs org:view in that org ───────────────────────────

async def test_org_members_refused_for_non_member(monkeypatch):
    from src.modules.authentication.rbac.rbac_service import RBACService
    from src.modules.organizations import router as org_router

    monkeypatch.setattr(RBACService, "check_permission", AsyncMock(return_value=False))
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(org_router.OrganizationService, "get_organization_members", fetch)
    with pytest.raises(HTTPException) as caught:
        await org_router.get_members(organization_id=str(uuid.uuid4()), user_id=str(uuid.uuid4()))
    assert caught.value.status_code == 403
    fetch.assert_not_called()


# ── 5. Saved chat assets belong to the person who saved them ────────────────

def test_asset_owner_requires_a_user():
    from src.modules.chats.assets.router import _owner

    with pytest.raises(HTTPException) as caught:
        _owner({"id": "not-a-uuid"})
    assert caught.value.status_code == 401
    uid = str(uuid.uuid4())
    assert _owner({"id": uid}) == uid


async def test_someone_elses_asset_is_not_returned():
    from src.modules.chats.assets.service import AssetService

    service = AssetService.__new__(AssetService)
    service.repository = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(
        user_id=uuid.uuid4(), is_deleted=False)))
    assert await service.get_asset(str(uuid.uuid4()), str(uuid.uuid4())) is None


async def test_asset_list_is_filtered_to_the_caller(monkeypatch):
    from src.modules.chats.assets import router as assets_router

    seen = {}

    async def fake_get_assets(filters, offset=0, limit=50):
        seen.update(filters)
        return {"items": [], "total": 0, "offset": 0, "limit": 50}

    monkeypatch.setattr(assets_router.service, "get_assets", fake_get_assets)
    uid = str(uuid.uuid4())
    await assets_router.get_assets(current_token={"id": uid})
    assert str(seen.get("user_id")) == uid


def test_asset_delete_is_scoped_to_owner():
    from src.modules.chats.assets.service import AssetService

    src = inspect.getsource(AssetService.delete_asset)
    assert "SavedAsset.user_id ==" in src


# ── 6. Ollama / BYOK endpoints must be public on SaaS ───────────────────────

@pytest.mark.parametrize("endpoint", ["http://10.0.0.5:11434", "http://postgres:5432", "http://[::1]:11434",
                                      "http://127.0.0.1:6379"])
async def test_ollama_tags_refuses_internal_endpoint(endpoint):
    from src.modules.user.router import list_ollama_tags

    with pytest.raises(HTTPException) as caught:
        await list_ollama_tags(endpoint=endpoint, current_token={"id": str(uuid.uuid4())})
    assert caught.value.status_code == 400


def test_byok_model_with_internal_endpoint_is_skipped():
    from src.modules.ai.services import user_byok_models as byok

    src = inspect.getsource(byok.hydrate_litellm_service_with_user_byok)
    assert "api_url_refusal" in src  # the loop refuses non-public endpoints before registering


# ── 7. AI endpoints that spend LLM budget need a signed-in caller ───────────

@pytest.mark.parametrize("name", ["analyze_sample_dataset", "test_ai_configuration", "ai_metrics"])
def test_ai_endpoints_require_login(name):
    from src.modules.ai import router as ai_router

    params = inspect.signature(getattr(ai_router, name)).parameters
    dep = params.get("current_token")
    assert dep is not None and "JWTCookieBearer" in repr(dep.default.dependency)


# ── 8. Server-local DuckDB / SQLite files are refused on SaaS ───────────────

async def test_local_duckdb_path_refused_on_saas():
    from src.shared import datasource_target as dt

    assert await dt.datasource_target_refusal({"database": "/app/data/x.duckdb"}, "duckdb") == dt.LOCAL_FILE_REFUSED
    assert await dt.datasource_target_refusal({"host": "/etc/passwd"}, "sqlite") == dt.LOCAL_FILE_REFUSED
    assert await dt.datasource_target_refusal({}, "duckdb") == dt.LOCAL_FILE_REFUSED
    assert await dt.datasource_target_refusal({"database": "md:my_db"}, "duckdb") is None


async def test_local_duckdb_allowed_on_self_host(monkeypatch):
    from src.shared import datasource_target as dt

    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert await dt.datasource_target_refusal({"database": "/data/x.duckdb"}, "duckdb") is None


def test_sample_duckdb_sources_unaffected():
    from src.shared import datasource_target as dt

    assert dt.config_of_data_source({"type": "sample_duckdb", "db_type": "duckdb",
                                     "connection_config": {"database": "/app/samples/x.duckdb"}})[1] is None


# ── 9. Feed digest sender fails closed ──────────────────────────────────────

@pytest.mark.parametrize("configured,sent", [("", None), ("", "anything"), ("s3cret", None), ("s3cret", "wrong")])
async def test_digest_send_refused_without_matching_secret(monkeypatch, configured, sent):
    from src.modules.feed.service_actions import FeedServiceActionMixin

    monkeypatch.setenv("FEED_DIGEST_CRON_SECRET", configured)
    svc = FeedServiceActionMixin.__new__(FeedServiceActionMixin)
    svc.get_digest_preview = AsyncMock(side_effect=AssertionError("must not send"))
    with pytest.raises(HTTPException) as caught:
        await svc.send_digest_emails(cron_secret=sent)
    assert caught.value.status_code == 403


async def test_digest_send_proceeds_with_matching_secret(monkeypatch):
    from src.modules.feed.service_actions import FeedServiceActionMixin

    monkeypatch.setenv("FEED_DIGEST_CRON_SECRET", "s3cret")
    svc = FeedServiceActionMixin.__new__(FeedServiceActionMixin)
    svc.get_digest_preview = AsyncMock(return_value=SimpleNamespace(items=[]))
    result = await svc.send_digest_emails(cron_secret="s3cret")
    assert result.skipped is True


# ── 10. /metrics ────────────────────────────────────────────────────────────

def _metrics_request(auth=None):
    headers = [(b"authorization", auth.encode())] if auth else []
    return SimpleNamespace(headers={k.decode(): v.decode() for k, v in headers})


async def test_metrics_hidden_on_saas_without_token(monkeypatch):
    from src.main import metrics_export

    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    with pytest.raises(HTTPException) as caught:
        await metrics_export(_metrics_request())
    assert caught.value.status_code == 404


async def test_metrics_needs_the_token_when_set(monkeypatch):
    from src.main import metrics_export

    monkeypatch.setenv("METRICS_TOKEN", "tok")
    with pytest.raises(HTTPException):
        await metrics_export(_metrics_request("Bearer nope"))
    response = await metrics_export(_metrics_request("Bearer tok"))
    assert response.status_code in (200, 503)


async def test_metrics_open_on_self_host_without_token(monkeypatch):
    from src.main import metrics_export

    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    response = await metrics_export(_metrics_request())
    assert response.status_code in (200, 503)


# ── Write-mode SQL already allows only routine DDL; keep it that way ─────────

@pytest.mark.parametrize("sql", [
    "ATTACH 'host=postgres dbname=railway' AS p (TYPE postgres)",
    "INSTALL postgres", "LOAD httpfs", "PRAGMA enable_external_access",
    "CREATE SECRET s (TYPE s3, KEY_ID 'x', SECRET 'y')",
    "CREATE OR REPLACE PERSISTENT SECRET s (TYPE s3)",
])
def test_write_mode_blocks_reach_out_statements(sql):
    from src.modules.data.services.multi_engine_query_service import check_sql_routine_ddl_safety

    assert check_sql_routine_ddl_safety(sql)


def test_write_mode_still_allows_routine_ddl():
    from src.modules.data.services.multi_engine_query_service import check_sql_routine_ddl_safety

    assert check_sql_routine_ddl_safety("CREATE OR REPLACE VIEW v AS SELECT 1") is None
