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


def test_supervisor_route_rag():
    from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor

    state = {"current_stage": "routed_to_rag", "data_source_id": "ds-1"}
    assert route_after_supervisor(state) == "rag"
