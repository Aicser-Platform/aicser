"""Query plan (POST /data/sources/{id}/analyze): sources without a db_type, DuckDB text plans."""

from unittest.mock import AsyncMock, patch

import pytest

from src.modules.data import router as data_router


async def _analyze(source: dict, engine_result: dict, sql: str = "SELECT * FROM data LIMIT 10"):
    with patch.object(data_router, "_require_data_source_permission", AsyncMock()), patch.object(
        data_router.data_service, "get_data_source_by_id", AsyncMock(return_value=source)
    ), patch.object(
        data_router.multi_engine_service, "execute_query", AsyncMock(return_value=engine_result)
    ) as run:
        out = await data_router.analyze_query(
            "ds-1", data_router.AnalyzeQueryRequest(sql=sql), current_token={"id": "u1"}, db=None
        )
    return out, run


@pytest.mark.asyncio
async def test_file_source_with_null_db_type_returns_duckdb_text_plan():
    out, run = await _analyze(
        {"id": "ds-1", "type": "file", "db_type": None},
        {"success": True, "data": [{"explain_key": "physical_plan", "explain_value": "SEQ_SCAN data"}]},
    )
    assert out["plan_error"] is None
    assert out["plan"] == [{"plan": "SEQ_SCAN data"}]
    assert run.await_args.kwargs["query"].startswith("EXPLAIN SELECT")


@pytest.mark.asyncio
async def test_write_statement_is_not_explained():
    out, run = await _analyze(
        {"id": "ds-1", "type": "database", "db_type": "postgresql"},
        {"success": True, "data": []},
        sql="DELETE FROM orders",
    )
    run.assert_not_awaited()
    assert out["plan"] is None
    assert out["plan_error"]


@pytest.mark.asyncio
async def test_engine_failure_is_reported_not_swallowed():
    out, _ = await _analyze(
        {"id": "ds-1", "type": "database", "db_type": None},
        {"success": False, "data": [], "error": "EXPLAIN not supported"},
    )
    assert out["plan"] is None
    assert "not supported" in out["plan_error"]
