import uuid

import pytest


def _disable_security_probes(service):
    """These tests exercise routing, not access control: report the source as
    having no RLS/CLS configured so the enforcement seams do not need a DB."""

    async def _no(_data_source_id):
        return False

    service._source_has_column_security = _no
    service._source_has_row_security = _no


async def test_pipeline_managed_source_never_reaches_direct_sql_engine(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import (
        MultiEngineQueryService, QueryEngine)

    async def fake_resolve(data_source):
        return {
            **data_source,
            "type": "lakehouse_iceberg",
            "storage_uri": "s3://lake/orgs/o1/gold/orders/",
            "format": "iceberg",
            "schema": {"columns": []},
        }

    monkeypatch.setattr(
        "src.modules.data.services.query_routing.resolve_query_source",
        fake_resolve,
    )

    service = MultiEngineQueryService()
    direct_sql_called = {"n": 0}

    async def fake_direct_sql_execute(query, data_source, analysis):
        direct_sql_called["n"] += 1
        return {"success": True, "data": [], "columns": [], "row_count": 0}

    async def fake_duckdb_execute(query, data_source, analysis):
        assert data_source["type"] == "lakehouse_iceberg"
        return {"success": True, "data": [], "columns": [], "row_count": 0}

    service.engines[QueryEngine.DIRECT_SQL].execute = fake_direct_sql_execute
    service.engines[QueryEngine.DUCKDB].execute = fake_duckdb_execute

    _disable_security_probes(service)

    result = await service.execute_query(
        "SELECT * FROM data",
        {"id": "ds-1", "type": "database", "db_type": "postgresql"},
        optimization=False,
    )

    assert result["success"] is True
    assert direct_sql_called["n"] == 0


async def test_lakehouse_not_ready_blocks_before_any_engine_runs(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import \
        MultiEngineQueryService
    from src.modules.data.services.query_routing import LakehouseNotReady

    async def fake_resolve(data_source):
        raise LakehouseNotReady(pipeline_id=uuid.uuid4(), last_run_status="queued")

    monkeypatch.setattr(
        "src.modules.data.services.query_routing.resolve_query_source",
        fake_resolve,
    )

    service = MultiEngineQueryService()

    async def fail_if_called(*a, **kw):
        raise AssertionError("no engine should run when the lakehouse isn't ready")

    for eng in service.engines.values():
        eng.execute = fail_if_called

    _disable_security_probes(service)

    result = await service.execute_query(
        "SELECT * FROM data",
        {"id": "ds-1", "type": "database"},
        optimization=False,
    )

    assert result["success"] is False
    assert "sync" in result["error"].lower() or "pipeline" in result["error"].lower()


async def test_execute_query_resolves_the_lakehouse_source_before_rls_and_cls(monkeypatch):
    """RLS/CLS must see the resolved source: the dialect they render predicates
    in, and (via the alias mapping) the table names they match, both come from
    the data_source dict they are handed."""
    from src.modules.data.services.multi_engine_query_service import \
        MultiEngineQueryService

    async def fake_resolve(data_source):
        return {
            **data_source,
            "type": "lakehouse_iceberg",
            "storage_uri": "s3://lake/orgs/o1/gold/orders/",
            "format": "iceberg",
            "schema": {"columns": []},
            "source_table": "orders",
        }

    monkeypatch.setattr(
        "src.modules.data.services.query_routing.resolve_query_source",
        fake_resolve,
    )

    service = MultiEngineQueryService()
    seen = {}

    async def fake_cls(query, data_source, access, dialect=None):
        seen["cls_type"] = data_source.get("type")
        return query, []

    async def fake_rls(query, data_source, access, dialect=None):
        seen["rls_type"] = data_source.get("type")
        seen["rls_source_table"] = data_source.get("source_table")
        return query, False

    service._enforce_column_security = fake_cls
    service._enforce_row_security = fake_rls

    async def fake_unfiltered(query, data_source, **kwargs):
        seen["engine_type"] = data_source.get("type")
        return {"success": True, "data": [], "columns": [], "row_count": 0}

    service._execute_query_unfiltered = fake_unfiltered

    result = await service.execute_query(
        "SELECT * FROM orders",
        {"id": "ds-1", "type": "database", "db_type": "postgresql"},
        optimization=False,
    )

    assert result["success"] is True
    assert seen["cls_type"] == "lakehouse_iceberg"
    assert seen["rls_type"] == "lakehouse_iceberg"
    assert seen["rls_source_table"] == "orders"
    assert seen["engine_type"] == "lakehouse_iceberg"


async def test_execute_query_reports_not_ready_before_any_enforcement_runs(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import \
        MultiEngineQueryService
    from src.modules.data.services.query_routing import LakehouseNotReady

    async def fake_resolve(data_source):
        raise LakehouseNotReady(pipeline_id=uuid.uuid4(), last_run_status="failed")

    monkeypatch.setattr(
        "src.modules.data.services.query_routing.resolve_query_source",
        fake_resolve,
    )

    service = MultiEngineQueryService()

    async def fail(*a, **kw):
        raise AssertionError("nothing should run when the lakehouse isn't ready")

    service._enforce_column_security = fail
    service._enforce_row_security = fail
    service._execute_query_unfiltered = fail

    result = await service.execute_query(
        "SELECT * FROM orders", {"id": "ds-1", "type": "database"}, optimization=False
    )

    assert result["success"] is False
    assert "pipeline" in result["error"].lower()


async def test_enforce_row_security_maps_the_lakehouse_data_table_to_the_real_name(
    monkeypatch,
):
    """The alias the rewriter needs so a policy written against "orders" still
    matches a lakehouse query that reads DuckDB's "data" table."""
    from src.modules.data.services.multi_engine_query_service import \
        MultiEngineQueryService

    service = MultiEngineQueryService()
    captured = {}

    async def fake_apply(query, **kwargs):
        captured.update(kwargs)
        return query, True

    service._apply_sql_rls = fake_apply

    from src.modules.data.services.query_identity import QueryIdentity

    identity = QueryIdentity(
        user_id="u1", organization_id="org-1", project_id="p1", token_payload={}
    )

    await service._enforce_row_security(
        'SELECT * FROM "data"',
        {
            "id": "ds-1",
            "type": "lakehouse_iceberg",
            "db_type": "postgresql",
            "source_table": "orders",
        },
        identity,
    )

    assert captured.get("table_name_aliases") == {"data": "orders"}
    assert captured.get("dialect") == "duckdb"
