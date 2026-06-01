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
    assert "dashboard_intent" in nodes
    assert "dashboard_materializer" in nodes


def test_data_analysis_plan_diagnostic_labels():
    steps = _build_data_analysis_plan("diagnostic")
    assert any("diagnos" in (s.get("label") or "").lower() for s in steps)
