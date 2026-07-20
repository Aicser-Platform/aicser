from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.utils.semantic_spec_execution import try_compile_semantic_spec

CTX = {
    "metrics": [{"id": "m1", "name": "total_sales", "expression": "SUM(amount)",
                 "metric_type": "simple", "certified": True}],
    "dimensions": [{"id": "d1", "name": "region", "expression": "region"}],
    "join_paths": [],
    "time_spines": [],
}
STATE = {"data_source_id": "ds1", "data_source_schema": {"table": "data"},
         "data_source_type": "file", "agent_context": {}}


@pytest.mark.asyncio
async def test_returns_none_without_spec():
    assert await try_compile_semantic_spec({"sql_query": "SELECT 1"}, STATE) is None


@pytest.mark.asyncio
@patch("ee.modules.ai.utils.semantic_spec_execution._load_semantic_context",
       new_callable=AsyncMock, return_value=CTX)
async def test_compiles_spec_to_sql(mock_ctx):
    parsed = {"semantic_query_spec": {"metric": "total_sales", "dimensions": ["region"]}}
    sql = await try_compile_semantic_spec(parsed, STATE)
    assert sql is not None
    assert "SUM(amount)" in sql
    assert "GROUP BY" in sql.upper()


@pytest.mark.asyncio
@patch("ee.modules.ai.utils.semantic_spec_execution._load_semantic_context",
       new_callable=AsyncMock, return_value=CTX)
async def test_unknown_metric_falls_back_to_none(mock_ctx):
    parsed = {"semantic_query_spec": {"metric": "no_such_metric"}}
    assert await try_compile_semantic_spec(parsed, STATE) is None


@pytest.mark.asyncio
@patch("ee.modules.ai.utils.semantic_spec_execution._load_semantic_context",
       new_callable=AsyncMock, return_value=CTX)
async def test_ignores_llm_supplied_data_source_id(mock_ctx):
    """The LLM's own data_source_id must never override the validated session value."""
    parsed = {"semantic_query_spec": {"metric": "total_sales", "dimensions": ["region"],
                                       "data_source_id": "attacker-controlled-ds"}}
    sql = await try_compile_semantic_spec(parsed, STATE)  # STATE["data_source_id"] == "ds1"
    assert sql is not None
    mock_ctx.assert_awaited_once()
    called_ds_id = mock_ctx.await_args.args[0] if mock_ctx.await_args.args else mock_ctx.await_args.kwargs.get("data_source_id")
    assert called_ds_id == "ds1"
