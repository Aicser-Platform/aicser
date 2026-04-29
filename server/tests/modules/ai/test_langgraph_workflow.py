"""
Integration tests for LangGraph workflow: graph structure, state shape, routing, and dialect module.

Run from server: pytest app/tests/modules/ai/test_langgraph_workflow.py -v
"""

import asyncio
import importlib
import pytest
from typing import Any, Dict
from unittest.mock import AsyncMock, patch


@pytest.fixture
def orchestrator():
    """Build orchestrator with minimal deps (no DB required for graph/state tests)."""
    try:
        from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator
        from src.modules.ai.services.litellm_service import LiteLLMService
    except ImportError as e:
        pytest.skip(f"LangGraph not available: {e}")
    litellm = LiteLLMService()
    return LangGraphMultiAgentOrchestrator(
        async_session_factory=None,
        sync_session_factory=None,
        litellm_service=litellm,
        data_service=None,
        multi_query_service=None,
        chart_service=None,
    )


def test_graph_builds_and_compiles(orchestrator):
    """Graph builds and compiles without error."""
    graph = orchestrator.graph
    assert graph is not None
    compiled = orchestrator.compiled_graph
    assert compiled is not None


def test_build_initial_state_shape(orchestrator):
    """Initial state has required keys and execution_metadata includes sql_dialect and node_timings."""
    state = orchestrator._build_initial_state(
        query="test query",
        conversation_id="c1",
        user_id="u1",
        organization_id="o1",
        data_source_id="ds1",
        data_source_schema={"t1": {"columns": [{"name": "a"}]}},
        data_source_db_type="clickhouse",
        analysis_mode="standard",
        model=None,
        user_preferences=None,
        query_intent=None,
    )
    assert state.get("query") == "test query"
    assert state.get("data_source_id") == "ds1"
    assert state.get("data_source_db_type") == "clickhouse"
    em = state.get("execution_metadata") or {}
    assert "node_timings" in em
    assert em.get("sql_dialect") == "clickhouse"
    assert "workflow_started_at" in em


def test_route_condition_nl2sql(orchestrator):
    """With data_source_id and no error, route goes to nl2sql, multi_step, or deep_file_analysis."""
    state: Dict[str, Any] = {
        "critical_failure": False,
        "error": None,
        "data_source_id": "ds1",
        "execution_metadata": {"analysis_mode": "standard"},
    }
    next_node = orchestrator._route_condition(state)
    assert next_node in ("nl2sql", "multi_step", "deep_file_analysis", "conversational_end", "error")


def test_route_condition_multi_step(orchestrator):
    """When current_stage is routed_to_multi_step, route goes to multi_step path."""
    state: Dict[str, Any] = {
        "critical_failure": False,
        "error": None,
        "data_source_id": "ds1",
        "current_stage": "routed_to_multi_step",
    }
    assert orchestrator._route_condition(state) == "multi_step"


def test_route_condition_error(orchestrator):
    """With error, route goes to error_recovery."""
    state = {"critical_failure": False, "error": "something broke", "data_source_id": "ds1"}
    assert orchestrator._route_condition(state) == "error"


def test_v2_no_evaluator_loop(orchestrator):
    """v2: no _unified_fallback_condition or _output_quality_gate_condition methods exist."""
    assert not hasattr(orchestrator, "_unified_fallback_condition"), \
        "v2 removed _unified_fallback_condition (unified_chart_insights → END directly)"
    assert not hasattr(orchestrator, "_output_quality_gate_condition"), \
        "v2 removed _output_quality_gate_condition"


def test_v2_graph_has_expected_nodes(orchestrator):
    """Graph has chart_builder, insight_engine, response_finalizer; no legacy chart_designer / output_quality_gate."""
    graph = orchestrator.graph
    node_names = set(graph.nodes.keys())
    for name in ("chart_builder", "insight_engine", "response_finalizer"):
        assert name in node_names, f"expected node '{name}' in graph"
    for removed in ("chart_designer", "output_quality_gate", "response_synthesis"):
        assert removed not in node_names, f"should not have legacy '{removed}' node"


def test_graph_has_mode_workflow_nodes(orchestrator):
    """Enterprise hardening: graph includes mode_requirements_gate, mode_query_planner, multi_query_execution, multi_step nodes."""
    graph = orchestrator.graph
    node_names = set(graph.nodes.keys())
    for name in ("mode_requirements_gate", "mode_query_planner", "multi_query_execution", "graceful_response"):
        assert name in node_names, f"expected node '{name}' in graph"
    for name in ("multi_step_planner", "multi_step_sql", "multi_step_execution"):
        assert name in node_names, f"expected multi-step node '{name}' in graph"


def test_multi_step_execution_condition(orchestrator):
    """Multi-step execution: multi_step_failed → failed (graceful_response); else proceed to post_query_brain."""
    state_fail = {"current_stage": "multi_step_failed"}
    assert orchestrator._multi_step_execution_condition(state_fail) == "failed"
    state_ok = {"current_stage": "multi_step_done"}
    assert orchestrator._multi_step_execution_condition(state_ok) == "proceed"


def test_mode_requirements_gate_condition_proceed(orchestrator):
    """Mode requirements gate: requirements met → proceed to mode_query_planner."""
    state = {"critical_failure": False, "current_stage": "mode_requirements_passed"}
    result = orchestrator._mode_requirements_gate_condition(state)
    assert result == "proceed", f"Expected 'proceed', got '{result}'"


def test_mode_requirements_gate_condition_clarify(orchestrator):
    """Mode requirements gate: unmet requirements clarify; critical failure graceful_response."""
    state = {"critical_failure": False, "current_stage": "mode_requirements_not_met"}
    result = orchestrator._mode_requirements_gate_condition(state)
    assert result == "clarify", f"Expected 'clarify', got '{result}'"
    state2 = {"critical_failure": True, "current_stage": "mode_requirements_passed"}
    assert orchestrator._mode_requirements_gate_condition(state2) == "graceful_response"


def test_multi_query_execution_condition(orchestrator):
    """Multi-query execution: explicit complete proceeds, failed errors out, critical fails."""
    state_fail = {"critical_failure": False, "current_stage": "multi_query_failed"}
    assert orchestrator._multi_query_execution_condition(state_fail) == "failed"
    state_ok = {"critical_failure": False, "current_stage": "multi_query_complete"}
    assert orchestrator._multi_query_execution_condition(state_ok) == "proceed"
    state_critical = {"critical_failure": True}
    assert orchestrator._multi_query_execution_condition(state_critical) == "failed"


@pytest.mark.asyncio
async def test_finalize_workflow_called_on_sync_exception(orchestrator):
    """When execute() raises during graph run, _finalize_workflow is still called so failed run is saved to conversation."""
    minimal_schema = {"schema": {"tables": [{"name": "t1", "columns": [{"name": "a"}]}]}, "db_type": "clickhouse", "data_source_name": "Test"}
    async def _failing_astream(*args, **kwargs):
        raise RuntimeError("simulated failure")
        yield

    with patch.object(orchestrator, "_get_schema_cached", new_callable=AsyncMock, return_value=minimal_schema):
        with patch.object(orchestrator, "compiled_graph", create=True) as mock_compiled:
            mock_compiled.astream = _failing_astream
            with patch.object(orchestrator, "_finalize_workflow", new_callable=AsyncMock) as mock_finalize:
                result = await orchestrator.execute(
                    query="test query",
                    conversation_id="conv-123",
                    user_id="u1",
                    organization_id="o1",
                    data_source_id="ds1",
                    analysis_mode="standard",
                )
                assert result.get("success") is False
                assert "simulated failure" in str(result.get("error", ""))
                mock_finalize.assert_called_once()
                call_args = mock_finalize.call_args[0]
                assert call_args[0] == "conv-123"
                assert call_args[1] == "test query"
                result_dict = mock_finalize.call_args[1].get("result_dict", {})
                assert result_dict.get("success") is False


def test_v2_quality_gate_removed(orchestrator):
    """Legacy quality gate condition is removed in v2 routing."""
    assert not hasattr(orchestrator, "_quality_gate_condition")


def test_sql_dialect_rules_module():
    """Centralized dialect rules and dialect library (sqlglot) integration."""
    try:
        from src.modules.ai.utils.sql_dialect_rules import (
            get_dialect_rules,
            get_dialect_name_for_prompt,
            get_fix_strategy_for_error,
            get_dialect_hint_for_llm_fix,
            get_sqlglot_dialect,
            translate_sql_to_dialect,
        )
    except ModuleNotFoundError as e:
        pytest.skip(f"App dependencies not installed (e.g. httpx): {e}")

    assert get_dialect_name_for_prompt("clickhouse") == "CLICKHOUSE"
    assert get_dialect_name_for_prompt(None) == "SQL"

    rules_ch = get_dialect_rules("clickhouse")
    assert "ClickHouse" in rules_ch and "aggregate" in rules_ch

    rules_pg = get_dialect_rules("postgresql")
    assert "PostgreSQL" in rules_pg

    assert get_fix_strategy_for_error("Code: 184. DB::Exception: ILLEGAL_AGGREGATION") == "illegal_aggregation"
    assert get_fix_strategy_for_error("Code: 60. DB::Exception: Unknown table expression identifier 'default.sales'") == "unknown_table"
    assert get_fix_strategy_for_error("window function not supported") == "clickhouse_window"
    assert get_fix_strategy_for_error("random error") is None

    hint = get_dialect_hint_for_llm_fix("clickhouse")
    assert "ClickHouse" in hint

    # sqlglot dialect name (aligned with SQLDialectTranslator)
    assert get_sqlglot_dialect("clickhouse") == "clickhouse"
    assert get_sqlglot_dialect("postgresql") == "postgres"
    assert get_sqlglot_dialect("duckdb") == "duckdb"
    assert get_sqlglot_dialect(None) == "postgres"

    # translate_sql_to_dialect returns (sql, applied); same dialect => no change
    out_sql, applied = translate_sql_to_dialect("SELECT 1", "postgresql", source_dialect="postgres")
    assert out_sql == "SELECT 1"
    assert isinstance(applied, bool)


# ─── Partial success & data-first routing (LLM-native BI workflow) ───


def _import_response_builder():
    """Import response_builder (requires app deps e.g. fastapi). Skip if not installed."""
    try:
        return importlib.import_module("app.modules.ai.services.response_builder")
    except ModuleNotFoundError:
        pytest.skip("App dependencies not installed (e.g. fastapi)")


def _import_schema_for_llm():
    """Import schema_for_llm (requires app). Skip if not installed."""
    try:
        from src.modules.ai.utils import schema_for_llm
        return schema_for_llm
    except ModuleNotFoundError:
        pytest.skip("App dependencies not installed (e.g. fastapi)")


def test_compute_partial_success_data_no_chart():
    """Partial success: has SQL + query_result but no chart/insights → partial_success True, tailored message."""
    rb = _import_response_builder()
    _compute_partial_success = rb._compute_partial_success
    state = {
        "sql_query": "SELECT 1",
        "query_result": [{"x": 1}],
        "query_result_row_count": 1,
        "echarts_config": None,
        "insights": None,
        "executive_summary": None,
        "error": None,
        "critical_failure": False,
    }
    out = _compute_partial_success(state)
    assert out["partial_success"] is True
    assert out["meaningful_output"] is True
    assert "query_result" in out["completed_components"]
    assert "chart" in out["missing_components"]
    assert "insights" in out["missing_components"]
    assert out["partial_message"] is not None
    assert "record" in out["partial_message"] or "data" in out["partial_message"].lower()


def test_compute_partial_success_full_success():
    """Full success: sql + query_result + chart + insights → partial_success False."""
    rb = _import_response_builder()
    _compute_partial_success = rb._compute_partial_success
    state = {
        "sql_query": "SELECT 1",
        "query_result": [{"x": 1}],
        "echarts_config": {"option": {}},
        "executive_summary": "Summary here.",
        # Empty insights list does not count; need at least one insight or long summary (>20 chars).
        "insights": [{"title": "A key finding from the data."}],
        "critical_failure": False,
    }
    out = _compute_partial_success(state)
    assert out["partial_success"] is False
    assert "chart" in out["completed_components"]
    assert "insights" in out["completed_components"]


def test_compute_partial_success_sql_only():
    """SQL generated but not executed: no meaningful output → partial_success False (contract: need data/chart/insights)."""
    rb = _import_response_builder()
    _compute_partial_success = rb._compute_partial_success
    state = {
        "sql_query": "SELECT 1",
        "query_result": None,
        "error": "Execution failed",
        "critical_failure": False,
    }
    out = _compute_partial_success(state)
    assert out["meaningful_output"] is False
    assert out["partial_success"] is False
    assert out["partial_message"] is None


def test_build_workflow_response_partial_success_preserves_insight_narration():
    """When partial_success is insights+data but chart failed, append partial banner; keep insight text."""
    rb = _import_response_builder()
    build_workflow_response = rb.build_workflow_response
    insight_body = (
        "Revenue rose 12% quarter over quarter with the northeast region leading growth; "
        "margins held steady despite higher logistics cost."
    )
    state = {
        "sql_query": "SELECT region, revenue FROM sales",
        "query_result": [{"region": "NE", "revenue": 100}],
        "query_result_row_count": 1,
        "echarts_config": None,
        "insights": [
            {
                "title": "Regional momentum",
                "description": insight_body,
                "confidence": 0.85,
                "impact": "high",
            }
        ],
        "recommendations": [],
        "executive_summary": None,
        "error": "echarts generation failed",
        "critical_failure": False,
        "current_stage": "chart_generator",
        "analytics_type": "descriptive",
    }
    result = build_workflow_response(state, query="Sales by region")
    narr = (result.get("narration") or "") + (result.get("message") or "")
    assert "Regional momentum" in narr or insight_body[:30] in narr
    assert "chart" in narr.lower()
    assert "insight" in narr.lower() or "data" in narr.lower()


def test_error_correction_condition_proceed_with_data(orchestrator):
    """Error correction failed but query_result has rows → proceed_with_data (prioritize chart+insights)."""
    state = {
        "critical_failure": False,
        "current_stage": "sql_correction_failed",
        "query_result": [{"a": 1}, {"a": 2}],
        "sql_query": "SELECT a FROM t",
    }
    result = orchestrator._error_correction_condition(state)
    assert result == "proceed_with_data"
    assert state.get("current_stage") == "proceed_with_data"
    assert state.get("error") is None


def test_error_correction_condition_failed_no_data(orchestrator):
    """Error correction failed and no query_result/no SQL → failed (graceful_response)."""
    state = {
        "critical_failure": False,
        "current_stage": "sql_correction_failed",
        "query_result": [],
        "sql_query": None,
    }
    result = orchestrator._error_correction_condition(state)
    assert result == "failed"


def test_schema_retrieval_single_table_source():
    """Single-table sources (file, api) get full schema; is_single_table_source and get_relevant_schema_subset."""
    schema_llm = _import_schema_for_llm()
    is_single_table_source = schema_llm.is_single_table_source
    get_relevant_schema_subset = schema_llm.get_relevant_schema_subset
    assert is_single_table_source("file") is True
    assert is_single_table_source("csv") is True
    assert is_single_table_source("api") is True
    assert is_single_table_source("database") is False
    assert is_single_table_source("clickhouse") is False
    assert is_single_table_source(None) is False

    # Full schema for file: one table "data" with columns
    file_schema = {
        "type": "file",
        "tables": [{"name": "data", "columns": [{"name": "col1"}, {"name": "col2"}]}],
    }
    subset = get_relevant_schema_subset(file_schema, "show sales", data_source_type="file")
    assert subset is not None
    tables = subset.get("tables", [])
    assert len(tables) == 1
    assert tables[0].get("name") == "data"
    cols = tables[0].get("columns", [])
    assert len(cols) >= 2


def test_schema_retrieval_multi_table_subset():
    """Multi-table schema: get_relevant_schema_subset returns up to max_tables, all columns per table."""
    schema_llm = _import_schema_for_llm()
    get_relevant_schema_subset = schema_llm.get_relevant_schema_subset
    # 8 tables: should get subset by relevance (query "sales revenue")
    tables = [
        {"name": "sales", "columns": [{"name": "id"}, {"name": "amount"}, {"name": "revenue"}]},
        {"name": "revenue_report", "columns": [{"name": "id"}, {"name": "total"}]},
        {"name": "products", "columns": [{"name": "id"}, {"name": "name"}]},
        {"name": "customers", "columns": [{"name": "id"}, {"name": "name"}]},
        {"name": "regions", "columns": [{"name": "id"}]},
        {"name": "logs", "columns": [{"name": "id"}]},
        {"name": "config", "columns": [{"name": "k"}]},
        {"name": "audit", "columns": [{"name": "id"}]},
    ]
    schema = {"type": "database", "tables": tables}
    subset = get_relevant_schema_subset(
        schema, "sales revenue by region", data_source_type="database", max_tables=4
    )
    assert subset is not None
    out_tables = subset.get("tables", [])
    assert len(out_tables) <= 4
    # sales and revenue_report should be high relevance; each table keeps all columns
    names = [t.get("name") for t in out_tables]
    assert "sales" in names or "revenue_report" in names
    for t in out_tables:
        cols = t.get("columns", [])
        assert len(cols) >= 1
