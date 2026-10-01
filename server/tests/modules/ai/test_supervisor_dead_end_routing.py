"""Stages where the supervisor already answered must not fall through to SQL."""

from ee.modules.ai.orchestrator.supervisor_routing import route_after_supervisor


def test_dashboard_without_project_ends_with_supervisor_message():
    for stage in ("dashboard_missing_project", "dashboard_missing_datasource"):
        state = {"current_stage": stage, "data_source_id": "ds1", "execution_metadata": {}}
        assert route_after_supervisor(state) == "conversational_end"
