"""Tests for sticky dashboard lifecycle intent detection (no full app bootstrap)."""

import sys
import types


def _install_graph_state_stub():
    if "src.modules.ai.schemas.graph_state" in sys.modules:
        return
    pkg_chain = [
        "src",
        "src.modules",
        "src.modules.ai",
        "src.modules.ai.schemas",
    ]
    for name in pkg_chain:
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
    stub = types.ModuleType("src.modules.ai.schemas.graph_state")
    stub.AiserWorkflowState = dict  # type: ignore[attr-defined]

    def advance_plan_step(state, step_id, status="complete", result_summary=None):  # noqa: ARG001
        return None

    stub.advance_plan_step = advance_plan_step  # type: ignore[attr-defined]
    sys.modules["src.modules.ai.schemas.graph_state"] = stub


_install_graph_state_stub()

from ee.modules.ai.nodes.dashboard_lifecycle_node import detect_dashboard_lifecycle_action  # noqa: E402


def test_detect_change_chart_is_refine_with_sticky():
    action = detect_dashboard_lifecycle_action(
        "Change the main bar chart to a line chart",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "refine"


def test_detect_explain_widget_is_analyze():
    action = detect_dashboard_lifecycle_action(
        "Explain what the Revenue widget shows and the key takeaway",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "analyze"


def test_detect_add_kpi_is_refine():
    action = detect_dashboard_lifecycle_action(
        "Add a KPI widget to this dashboard",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "refine"


def test_detect_undo():
    action = detect_dashboard_lifecycle_action(
        "Undo the last dashboard change",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "undo"


def test_detect_explicit_create_even_with_sticky():
    action = detect_dashboard_lifecycle_action(
        "Create a new dashboard for sales",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "create"


def test_explicit_action_wins():
    action = detect_dashboard_lifecycle_action(
        "whatever text",
        {"target_dashboard_id": "dash-1", "dashboard_lifecycle_action": "update"},
    )
    assert action == "update"


def test_explicit_undo_wins():
    action = detect_dashboard_lifecycle_action(
        "add a kpi",
        {"target_dashboard_id": "dash-1", "dashboard_lifecycle_action": "undo"},
    )
    assert action == "undo"
