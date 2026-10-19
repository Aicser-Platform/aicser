from ee.modules.ai.nodes.response_finalizer_node import (
    _check_completeness,
    _is_rag_only_turn,
)
from ee.modules.ai.orchestrator.graph_conditions import rag_route_condition


def test_rag_route_complete_still_maps_to_complete():
    assert rag_route_condition({"current_stage": "rag_complete"}) == "complete"
    assert rag_route_condition({"current_stage": "rag_to_nl2sql"}) == "to_nl2sql"


def test_rag_only_with_summary_is_complete():
    state = {
        "current_stage": "rag_complete",
        "executive_summary": "The credit policy sets a 12.4 percent ceiling on unsecured exposure.",
        "rag_citations": [{"excerpt": "unsecured exposure ceiling is 12.4 percent"}],
    }
    assert _is_rag_only_turn(state) is True
    ok, issue = _check_completeness(state)
    assert ok is True
    assert issue is None


def test_sql_turn_is_not_rag_only():
    state = {
        "current_stage": "rag_complete",
        "sql_query": "SELECT 1",
        "executive_summary": "This summary is long enough to pass the length check.",
    }
    assert _is_rag_only_turn(state) is False


def test_rag_missing_summary_is_incomplete_without_chart_requirement():
    state = {
        "current_stage": "rag_complete",
        "rag_citations": [{"excerpt": "policy text"}],
    }
    ok, issue = _check_completeness(state)
    assert ok is False
    assert "RAG" in (issue or "")
