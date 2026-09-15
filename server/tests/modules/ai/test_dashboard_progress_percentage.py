"""Regression test: Dashboard mode's progress bar must advance through its
five PESD stages, not stay flat until the very end.

Root cause this guards against: every stage set a real, specific
progress_message ("Designed 6 KPI widgets", "Validated data for 5/6
widgets", ...) but only the final node ever set progress_percentage --
every other multi-stage mode in the platform (Auto via update_progress(),
Business OS's assess phase) advances both together, so Dashboard's own
progress bar visibly stalled through four real stages of work before
jumping straight to 100.
"""

import pytest

from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_intent_planner_node


@pytest.mark.asyncio
async def test_intent_planner_sets_a_nonzero_progress_percentage():
    state = {"query": "Build an executive KPI dashboard for revenue"}

    out = await dashboard_intent_planner_node(state)

    assert out["current_stage"] == "dashboard_intent_planned"
    assert isinstance(out.get("progress_percentage"), (int, float))
    assert 0 < out["progress_percentage"] < 100
