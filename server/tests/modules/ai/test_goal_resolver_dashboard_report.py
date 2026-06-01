"""Goal resolver — dashboard + report/export combo."""

from ee.modules.ai.kernel.goal_resolver import resolve_goal_heuristic
from ee.modules.ai.kernel.schemas import DeliverableType


def test_dashboard_and_export_is_multi_step():
    goal = resolve_goal_heuristic(
        {
            "query": "Build a dashboard with KPIs and export a report",
            "agent_context": {},
            "data_source_id": "ds-1",
            "project_id": "proj-1",
        }
    )
    assert goal.deliverable_type == DeliverableType.multi_step
    assert any("dashboard" in c.lower() for c in goal.success_criteria)


def test_dashboard_only_stays_dashboard():
    goal = resolve_goal_heuristic(
        {
            "query": "Build a KPI dashboard for loan performance",
            "agent_context": {},
            "data_source_id": "ds-1",
            "project_id": "proj-1",
        }
    )
    assert goal.deliverable_type == DeliverableType.dashboard
