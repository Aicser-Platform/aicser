import uuid

import pytest


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

    result = await service._execute_query_unfiltered(
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

    result = await service._execute_query_unfiltered(
        "SELECT * FROM data",
        {"id": "ds-1", "type": "database"},
        optimization=False,
    )

    assert result["success"] is False
    assert "sync" in result["error"].lower() or "pipeline" in result["error"].lower()
