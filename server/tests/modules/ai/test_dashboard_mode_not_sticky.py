"""Regression tests for a live bug: a plain data question sent right after a
dashboard was created in the same conversation got misrouted into dashboard
building (and then failed) instead of being answered.

Root cause, two independent interception points in supervisor_node.py, both
upstream of the dashboard-lifecycle-aware routing ladder that would have
correctly identified the query as NOT a dashboard action:

1. should_use_agent_kernel() (goal_resolver.py) excludes decision_intelligence/
   diagnostic/predictive/prescriptive/animate because each has its own
   dedicated pipeline elsewhere in supervisor_node.py that a generic kernel
   goal/plan/execute/verify pass doesn't replicate -- "dashboard" was never
   added to that list despite also having its own dedicated (PESD) pipeline,
   so a request whose analysis_mode was still "dashboard" from an earlier
   turn got claimed by the generic Agent Kernel before dashboard's own
   dedicated routing ever got a turn. Live-reproduced: "how many students by
   grade" got the kernel's generic "Next, I am planning
   execution." text and failed.

2. Even after excluding "dashboard" from the kernel, Phase 3's fast-route
   ("Dashboard builder — explicit analysis_mode from UI") ALSO routed
   unconditionally to dashboard_intent purely from analysis_mode=="dashboard",
   with no lifecycle-awareness at all -- so it would have caught the same
   query and (incorrectly) tried to dashboard-build it anyway. Fixed to defer
   to detect_dashboard_lifecycle_action() once a sticky target_dashboard_id
   exists, the same lifecycle check the later ladder already trusts for this
   exact decision.
"""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.kernel.goal_resolver import should_use_agent_kernel
from ee.modules.ai.nodes.supervisor_node import supervisor_node


def test_should_use_agent_kernel_declines_dashboard_mode():
    state = {
        "query": "how many students by grade",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "dashboard"},
    }
    assert should_use_agent_kernel(state) is False


def _base_state(query: str, **overrides) -> dict:
    state = {
        "query": query,
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds1",
        "data_source_schema": {"tables": []},
        "agent_context": {"analysis_mode": "dashboard"},
    }
    state.update(overrides)
    return state


def _lenient_litellm_service():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})
    return mock


@pytest.mark.asyncio
async def test_stale_dashboard_mode_falls_through_to_normal_routing_not_kernel_or_dashboard():
    """Reproduces the live scenario end-to-end: a sticky target_dashboard_id
    from an earlier turn plus a plain data question, both carrying
    analysis_mode="dashboard" left over from that earlier turn. Must land on
    normal nl2sql-family routing, not agent_kernel and not dashboard_intent."""
    state = _base_state("how many students by grade", target_dashboard_id="dash-1")
    out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] != "routed_to_agent_kernel"
    assert "dashboard" not in str(out["current_stage"])


@pytest.mark.asyncio
async def test_genuine_dashboard_edit_on_sticky_dashboard_still_routes_to_dashboard():
    """Control case: a real dashboard-edit follow-up on an existing sticky
    dashboard must still route to dashboard handling - the fix must not
    over-correct into ignoring genuine dashboard actions."""
    state = _base_state("add a kpi to this dashboard", target_dashboard_id="dash-1")
    out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert "dashboard" in str(out["current_stage"])
    assert out["current_stage"] != "routed_to_agent_kernel"


@pytest.mark.asyncio
async def test_first_time_dashboard_create_with_no_sticky_dashboard_still_works():
    """Control case: a genuine first-time "build me a dashboard" request (no
    sticky target_dashboard_id yet) must be completely unaffected by the
    lifecycle-awareness fix, which only applies once a sticky dashboard
    exists to potentially misfire against."""
    state = _base_state("build a dashboard for sales KPIs")
    out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert "dashboard" in str(out["current_stage"])
    assert out["current_stage"] != "routed_to_agent_kernel"
