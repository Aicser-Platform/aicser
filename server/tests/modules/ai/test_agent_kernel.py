"""Tests for agent kernel planner, verifier, and continuation."""

from __future__ import annotations

import pytest

from ee.modules.ai.kernel.continuation import (
    budget_exhausted,
    build_continuation_message,
    get_budget_limits,
    load_plan_from_state,
    persist_continuation,
)
from ee.modules.ai.kernel.goal_resolver import resolve_goal_heuristic, should_use_agent_kernel
from ee.modules.ai.kernel.planner import build_plan
from ee.modules.ai.kernel.replanner import replan, should_replan
from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType, VerificationResult
from ee.modules.ai.kernel.verifier import verify_goal, verify_step


@pytest.mark.parametrize(
    "query,mode",
    [
        ("show revenue by month as a bar chart", "standard"),
        ("build a dashboard for sales KPIs", "dashboard"),
        ("analyze end to end and create executive report", "auto"),
    ],
)
def test_should_use_agent_kernel(query, mode):
    """should_use_agent_kernel is universal for modes with no dedicated pipeline of
    their own - the previous per-mode allowlist was replaced once analytics_pipeline
    stopped bypassing the real diagnostic/predictive/prescriptive engines. True for
    these modes regardless of the AISER_AGENT_KERNEL_ENABLED kill-switch being off."""
    state = {
        "query": query,
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": mode},
    }
    assert should_use_agent_kernel(state) is True


@pytest.mark.parametrize(
    "mode",
    ["decision_intelligence", "diagnostic", "predictive", "prescriptive", "animate"],
)
def test_should_use_agent_kernel_declines_modes_with_dedicated_pipelines(mode):
    """Live-reproduced bugs, one per mode: each of these has its own dedicated,
    better-tested handling elsewhere in supervisor_node.py that a generic kernel
    goal/plan/execute/verify pass doesn't replicate - Decide got the kernel's own
    "planning autonomous execution" text with no Decision Brief, Animate got a bare
    partial SQL result with no animated chart. should_use_agent_kernel() used to
    return True unconditionally, claiming all five before their own dedicated
    checks (further down supervisor_node.py) ever got a turn."""
    state = {
        "query": "some request",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": mode},
    }
    assert should_use_agent_kernel(state) is False

    # Also declines when the mode arrives via analytics_type instead of
    # analysis_mode - frontend_analytics_type's own multi-source fallback in
    # supervisor_node.py means either can carry the resolved value.
    state2 = {
        "query": "some request",
        "data_source_id": "ds-1",
        "agent_context": {"analytics_type": mode},
    }
    assert should_use_agent_kernel(state2) is False


def test_should_use_agent_kernel_declines_cube_backed_sources():
    """The kernel has no Cube.js-aware capability at all - only the classic
    graph's cube_query_node knows how to query a Cube-backed source, and it can
    only ever be selected by the LLM orchestrator, which never runs once the
    kernel claims the request first."""
    state = {
        "query": "what's total revenue this quarter",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "auto"},
        "cube_schema": {"cubes": [{"name": "Revenue"}]},
    }
    assert should_use_agent_kernel(state) is False


@pytest.mark.parametrize(
    "query",
    [
        "give me a deep dive on this file",
        "do a deep analysis of this dataset",
        "profile this data for me",
        "I need an in-depth analysis of the uploaded spreadsheet",
    ],
)
def test_should_use_agent_kernel_declines_deep_file_analysis_intent(query):
    """deep_file_analysis_node does independent data profiling and LLM-generated
    Python analysis with no kernel-capability equivalent - same unreachability
    bug as Cube's, via the same never-runs LLM-orchestrator path."""
    state = {
        "query": query,
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "auto"},
    }
    assert should_use_agent_kernel(state) is False


def test_resolve_goal_dashboard():
    state = {
        "query": "Build a sales dashboard",
        "agent_context": {"analysis_mode": "dashboard"},
        "project_id": "p1",
    }
    goal = resolve_goal_heuristic(state)
    assert goal.deliverable_type == DeliverableType.dashboard
    assert goal.min_widget_count >= 3


@pytest.mark.asyncio
async def test_build_plan_dashboard():
    goal = AgentGoal(
        objective="Sales dashboard",
        deliverable_type=DeliverableType.dashboard,
    )
    plan = await build_plan(goal, {"dashboard_tier": "executive"}, litellm_service=None)
    assert len(plan.steps) == 1
    assert plan.steps[0].capability == "create_dashboard"


def test_verify_step_dashboard_failure():
    step = AgentPlanStep(id="d1", capability="create_dashboard", label="Build")
    step.status = "complete"
    state = {"dashboard_created": {"dashboard_id": "x", "widget_count": 1, "status": "partial"}}
    result = verify_step(step, state, {})
    assert result.passed is False
    assert any("widget" in i for i in result.issues)


def test_verify_goal_dashboard_contract():
    goal = AgentGoal(objective="Dash", deliverable_type=DeliverableType.dashboard, min_widget_count=3)
    state = {
        "dashboard_created": {"dashboard_id": "d1", "widget_count": 5, "status": "complete"},
        "message": "Dashboard ready with 5 widgets for your team.",
    }
    v = verify_goal(goal, state)
    assert v.passed is True


def test_replan_adds_heal_step():
    plan = AgentPlan(
        goal=AgentGoal(objective="x", deliverable_type=DeliverableType.dashboard),
        steps=[AgentPlanStep(id="s1", capability="create_dashboard", label="Create", status="failed")],
    )
    state: dict = {"replan_count": 0}
    verification = VerificationResult(passed=False, heal_action="dashboard_heal", issues=["few_widgets:1"])
    assert should_replan(state, verification)
    new_plan = replan(plan, state, verification)
    assert len(new_plan.steps) == 2
    assert new_plan.steps[-1].capability == "create_dashboard"


def test_continuation_persist_and_load():
    goal = AgentGoal(objective="Multi step", deliverable_type=DeliverableType.multi_step)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id="a", capability="analytics_pipeline", label="Analyze", status="complete"),
            AgentPlanStep(id="b", capability="create_dashboard", label="Dashboard", status="pending"),
        ],
        cursor=1,
    )
    state: dict = {}
    token = persist_continuation(state, plan)
    assert token
    assert state.get("needs_agent_continuation") is True
    loaded = load_plan_from_state(state)
    assert loaded is not None
    assert loaded.cursor == 1
    msg = build_continuation_message(loaded, token)
    assert "continue" in msg.lower() or "resume" in msg.lower()


def test_budget_exhausted():
    max_steps, _ = get_budget_limits()
    goal = AgentGoal(objective="x", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id=f"s{i}", capability="run_sql", label=f"S{i}", status="complete")
            for i in range(max_steps + 2)
        ],
        cursor=max_steps + 2,
    )
    state = {"replan_count": 0}
    assert budget_exhausted(state, plan) is True


def test_budget_not_exhausted_below_the_step_cap():
    max_steps, _ = get_budget_limits()
    goal = AgentGoal(objective="x", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id=f"s{i}", capability="run_sql", label=f"S{i}", status="complete")
            for i in range(max_steps - 1)
        ],
        cursor=max_steps - 1,
    )
    state = {"replan_count": 0}
    assert budget_exhausted(state, plan) is False
