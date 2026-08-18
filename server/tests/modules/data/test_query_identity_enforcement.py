"""Row security must be enforced by the query service, not by one HTTP handler.

Before this, apply_sql_rls had a single call site inside POST /data/query/execute,
so chat, dashboard widgets, the chart builder and the legacy source endpoint all
reached the engine unfiltered. These tests pin the gate to the service itself.
"""

import os

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
from src.modules.data.services import multi_engine_query_service as meq
from src.modules.data.services.multi_engine_query_service import MultiEngineQueryService
from src.modules.data.services.query_identity import (
    QueryIdentity,
    RowSecurityIdentityRequired,
    SystemQuery,
)


SECURED_SOURCE = {"id": "ds-1", "type": "file", "organization_id": "org-1"}


@pytest.fixture
def service():
    return MultiEngineQueryService()


def test_query_identity_rejects_a_blank_user():
    with pytest.raises(ValueError):
        QueryIdentity(user_id="")


def test_system_query_demands_a_stated_reason():
    """An unattributed read has to say why, so it shows up in a log review."""
    with pytest.raises(ValueError):
        SystemQuery(reason="")
    assert SystemQuery(reason="scheduled materialized view refresh").reason


@pytest.mark.asyncio
async def test_ce_is_untouched(service, monkeypatch):
    """CE has no grants or policies, so enforcement is a no-op there."""
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: False)

    query, applied = await service._enforce_row_security(
        "SELECT * FROM fact_orders", SECURED_SOURCE, None
    )

    assert applied is False
    assert query == "SELECT * FROM fact_orders"


@pytest.mark.asyncio
async def test_missing_identity_on_a_secured_source_fails_closed(service, monkeypatch):
    """The whole point: no identity, no data — for sources that opted into security."""
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def secured(_source_id):
        return True

    monkeypatch.setattr(service, "_source_has_row_security", secured)

    with pytest.raises(RowSecurityIdentityRequired):
        await service._enforce_row_security(
            "SELECT * FROM fact_orders", SECURED_SOURCE, None
        )


@pytest.mark.asyncio
async def test_missing_identity_on_an_unsecured_source_still_runs(service, monkeypatch):
    """Sources with no policy or grant keep working, so this change can land."""
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def unsecured(_source_id):
        return False

    monkeypatch.setattr(service, "_source_has_row_security", unsecured)

    query, applied = await service._enforce_row_security(
        "SELECT * FROM fact_orders", SECURED_SOURCE, None
    )

    assert applied is False
    assert query == "SELECT * FROM fact_orders"


@pytest.mark.asyncio
async def test_system_query_bypasses_but_is_recorded(service, monkeypatch, caplog):
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def secured(_source_id):
        return True

    monkeypatch.setattr(service, "_source_has_row_security", secured)

    with caplog.at_level("WARNING"):
        query, applied = await service._enforce_row_security(
            "SELECT * FROM fact_orders",
            SECURED_SOURCE,
            SystemQuery(reason="materialized view refresh"),
        )

    assert applied is False
    assert query == "SELECT * FROM fact_orders"
    assert "materialized view refresh" in caplog.text


@pytest.mark.asyncio
async def test_identity_applies_the_row_filter(service, monkeypatch):
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    captured = {}

    async def fake_apply(query, **kwargs):
        captured.update(kwargs)
        return f"SELECT * FROM ({query}) AS rls_q WHERE region = 'APAC'", True

    monkeypatch.setattr(service, "_apply_sql_rls", fake_apply)

    query, applied = await service._enforce_row_security(
        "SELECT * FROM fact_orders",
        SECURED_SOURCE,
        QueryIdentity(
            user_id="user-1", organization_id="org-1", project_id="project-1"
        ),
    )

    assert applied is True
    assert "region = 'APAC'" in query
    assert captured["user_id"] == "user-1"
    assert captured["data_source_id"] == "ds-1"


@pytest.mark.asyncio
async def test_enforcement_failure_denies_rather_than_leaking(service, monkeypatch):
    """If the filter cannot be computed, the read must not fall through unfiltered."""
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def boom(_query, **_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(service, "_apply_sql_rls", boom)

    with pytest.raises(RowSecurityIdentityRequired):
        await service._enforce_row_security(
            "SELECT * FROM fact_orders",
            SECURED_SOURCE,
            QueryIdentity(user_id="user-1"),
        )


@pytest.mark.asyncio
async def test_execute_query_runs_the_gate_before_touching_data(monkeypatch):
    """The gate must be inside execute_query, not upstream of it.

    Every bypass in the audit existed because callers reached this method
    directly. If enforcement is here, there is no way around it.
    """
    service = MultiEngineQueryService()
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def secured(_source_id):
        return True

    monkeypatch.setattr(service, "_source_has_row_security", secured)

    reached = {"engine": False}

    async def _should_not_run(*_args, **_kwargs):
        reached["engine"] = True
        return {"success": True, "data": []}

    monkeypatch.setattr(service, "_execute_with_engine", _should_not_run, raising=False)

    result = await service.execute_query(
        "SELECT * FROM fact_orders", SECURED_SOURCE, identity=None
    )

    assert reached["engine"] is False
    assert result["success"] is False
    assert "row security" in result["error"].lower()


@pytest.mark.asyncio
async def test_result_reports_that_a_filter_was_applied(monkeypatch):
    """The Query Editor chip reads this flag; the service now owns it."""
    service = MultiEngineQueryService()
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)

    async def fake_apply(query, **_kwargs):
        return f"SELECT * FROM ({query}) AS rls_q WHERE 1 = 1", True

    async def fake_exec(*_args, **_kwargs):
        return {"success": True, "data": [], "columns": []}

    monkeypatch.setattr(service, "_apply_sql_rls", fake_apply)
    monkeypatch.setattr(service, "_execute_query_unfiltered", fake_exec)

    result = await service.execute_query(
        "SELECT * FROM fact_orders",
        SECURED_SOURCE,
        identity=QueryIdentity(user_id="user-1"),
    )

    assert result["rls_applied"] is True


@pytest.mark.asyncio
async def test_filtered_queries_skip_the_optimizer(monkeypatch):
    """A per-user predicate must not be rewritten or shared by the optimizer."""
    service = MultiEngineQueryService()
    monkeypatch.setattr(meq, "is_ee_enabled", lambda: True)
    seen = {}

    async def fake_apply(query, **_kwargs):
        return query, True

    async def fake_exec(*_args, **kwargs):
        seen.update(kwargs)
        return {"success": True}

    monkeypatch.setattr(service, "_apply_sql_rls", fake_apply)
    monkeypatch.setattr(service, "_execute_query_unfiltered", fake_exec)

    await service.execute_query(
        "SELECT 1",
        SECURED_SOURCE,
        optimization=True,
        identity=QueryIdentity(user_id="user-1"),
    )

    assert seen["optimization"] is False
