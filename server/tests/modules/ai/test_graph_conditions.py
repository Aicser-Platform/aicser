"""Graph condition routing tests."""

from ee.modules.ai.orchestrator.graph_conditions import (
    analytics_render_condition,
    deep_file_analysis_condition,
    rag_route_condition,
    route_after_report_planner,
)


def test_rag_route_hybrid():
    assert rag_route_condition({"current_stage": "rag_to_nl2sql"}) == "to_nl2sql"


def test_rag_route_complete():
    assert rag_route_condition({"current_stage": "rag_complete"}) == "complete"


def test_deep_file_routes_to_analytics():
    assert deep_file_analysis_condition({"query_result": [{"a": 1}]}) == "analytics_node"


def test_report_planner_failed():
    assert route_after_report_planner({"current_stage": "report_plan_failed"}) == "report_synthesis"


def test_analytics_render_failed():
    assert analytics_render_condition({"current_stage": "analytics_render_failed"}) == "unrecoverable"
