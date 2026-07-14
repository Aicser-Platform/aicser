"""Supervisor plan template tests."""

from ee.modules.ai.nodes.supervisor.plan_templates import (
    _build_dashboard_plan,
    _build_data_analysis_plan,
    _infer_analytics_type_from_query,
)


def test_infer_predictive_from_query():
    assert _infer_analytics_type_from_query("Forecast revenue for next 6 months") == "predictive"


def test_infer_diagnostic_from_query():
    assert _infer_analytics_type_from_query("Why did sales drop last quarter?") == "diagnostic"


def test_dashboard_plan_has_pesd_steps():
    steps = _build_dashboard_plan()
    nodes = [s.get("node") for s in steps]
    assert "dashboard_lifecycle_router" in nodes
    assert "dashboard_materializer" in nodes


def test_data_analysis_plan_diagnostic_labels():
    steps = _build_data_analysis_plan("diagnostic")
    assert any("diagnos" in (s.get("label") or "").lower() for s in steps)


def test_decision_intelligence_and_all_aliases_are_preserved():
    from src.modules.ai.config.workflow_config import get_effective_analytics_type

    assert get_effective_analytics_type("decision_intelligence", "standard") == "decision_intelligence"
    assert get_effective_analytics_type(None, "decision_intelligence") == "decision_intelligence"
    assert get_effective_analytics_type(None, "all") == "decision_intelligence"
    assert get_effective_analytics_type("all_analytics", "standard") == "decision_intelligence"


def test_initial_state_normalizes_all_alias():
    from src.modules.ai.orchestrator.initial_state import build_initial_state

    state = build_initial_state(
        litellm_service=object(),
        query="Create 2 charts in all mode",
        conversation_id="conv",
        user_id="user",
        organization_id="org",
        analysis_mode="standard",
        analytics_type="all",
    )
    assert state["analytics_type"] == "decision_intelligence"
    assert state["execution_metadata"]["analytics_type"] == "decision_intelligence"


def test_requested_multiple_charts_detector():
    from ee.modules.ai.nodes.supervisor_node import _requested_multiple_charts

    assert _requested_multiple_charts("Create 2 charts for revenue")
    assert _requested_multiple_charts("Show two visualizations of sales")
    assert _requested_multiple_charts("Create a revenue animation chart") is False


def test_combined_mode_allows_second_chart():
    from ee.modules.ai.nodes.chart_builder_node import _chart_breadth_limits

    limits = _chart_breadth_limits(
        analytics_type="diagnostic_prescriptive_predictive",
        has_multi_step_results=False,
        dataset_count=1,
    )
    assert limits["complementary_charts"] >= 1
