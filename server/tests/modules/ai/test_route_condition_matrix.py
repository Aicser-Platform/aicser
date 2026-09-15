"""Route condition matrix smoke tests."""

import pytest

pytest.importorskip("langgraph")


def test_supervisor_route_nl2sql():
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {"current_stage": "routed_to_nl2sql", "data_source_id": "ds-1"}
    assert route_after_supervisor(state) == "nl2sql"


def test_supervisor_route_dashboard():
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {"current_stage": "routed_to_dashboard", "project_id": "p1", "data_source_id": "ds-1"}
    assert route_after_supervisor(state) == "dashboard"


def test_supervisor_route_dashboard_analysis_mode_fallback_still_works_without_sticky_target():
    """Control case: a genuine dashboard request with no sticky dashboard yet
    (analysis_mode fallback path, no explicit routed_to_dashboard* stage) must
    still route to dashboard - the lifecycle-awareness fix only applies once a
    sticky target_dashboard_id exists to potentially misfire against."""
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {
        "current_stage": "some_other_stage",
        "data_source_id": "ds-1",
        "execution_metadata": {"analysis_mode": "dashboard"},
        "query": "build a dashboard for sales KPIs",
    }
    assert route_after_supervisor(state) == "dashboard"


def test_supervisor_route_dashboard_fallback_ignores_stale_mode_with_sticky_target():
    """Regression, third and final interception point for a live bug: a
    plain data question ("how many students by grade") sent with a sticky
    target_dashboard_id and a stale analysis_mode="dashboard" left over from
    an earlier turn in the same conversation reached this exact
    analysis_mode fallback (current_stage wasn't an explicit
    routed_to_dashboard* value, since supervisor_node.py's own routing had
    already correctly declined to treat it as a dashboard action) and got
    routed to dashboard PESD anyway. Must fall through to nl2sql instead,
    deferring to detect_dashboard_lifecycle_action's classification of this
    specific query the same way supervisor_node.py's own dashboard-routing
    checks already do."""
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {
        "current_stage": "routed_to_nl2sql",
        "data_source_id": "ds-1",
        "execution_metadata": {"analysis_mode": "dashboard"},
        "query": "how many students by grade",
        "target_dashboard_id": "dash-1",
    }
    assert route_after_supervisor(state) == "nl2sql"


def test_supervisor_route_dashboard_fallback_still_fires_for_genuine_edit_on_sticky_target():
    """Control case: a genuine dashboard-edit follow-up on an existing sticky
    dashboard, reaching this fallback (rather than an explicit
    routed_to_dashboard* stage), must still route to dashboard."""
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {
        "current_stage": "some_other_stage",
        "data_source_id": "ds-1",
        "execution_metadata": {"analysis_mode": "dashboard"},
        "query": "add a kpi to this dashboard",
        "target_dashboard_id": "dash-1",
    }
    assert route_after_supervisor(state) == "dashboard"


def test_supervisor_route_rag():
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {"current_stage": "routed_to_rag", "data_source_id": "ds-1"}
    assert route_after_supervisor(state) == "rag"
