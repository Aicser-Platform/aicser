"""Tests for agent kernel planner, verifier, and continuation."""

from __future__ import annotations

import pytest

from ee.modules.ai.kernel.continuation import (
    budget_exhausted,
    build_continuation_message,
    load_plan_from_state,
    persist_continuation,
)
from ee.modules.ai.kernel.goal_resolver import resolve_goal_heuristic, should_use_agent_kernel
from ee.modules.ai.kernel.planner import build_plan
from ee.modules.ai.kernel.replanner import replan, should_replan
from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType, VerificationResult
from ee.modules.ai.kernel.verifier import verify_goal, verify_step


@pytest.mark.parametrize(
    "query,mode,expected",
    [
        ("show revenue by month as a bar chart", "standard", False),
        ("build a dashboard for sales KPIs", "dashboard", True),
        ("analyze end to end and create executive report", "auto", True),
    ],
)
def test_should_use_agent_kernel(query, mode, expected):
    state = {
        "query": query,
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": mode},
    }
    assert should_use_agent_kernel(state) is expected


def test_resolve_goal_dashboard():
    state = {
        "query": "Build a sales dashboard",
        "agent_context": {"analysis_mode": "dashboard"},
        "project_id": "p1",
    }
    goal = resolve_goal_heuristic(state)
    assert goal.deliverable_type == DeliverableType.dashboard
    assert goal.min_widget_count >= 3


def test_build_plan_dashboard():
    goal = AgentGoal(
        objective="Sales dashboard",
        deliverable_type=DeliverableType.dashboard,
    )
    plan = build_plan(goal, {"dashboard_tier": "executive"})
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
    goal = AgentGoal(objective="x", deliverable_type=DeliverableType.chart_analysis)
    plan = AgentPlan(
        goal=goal,
        steps=[
            AgentPlanStep(id=f"s{i}", capability="run_sql", label=f"S{i}", status="complete")
            for i in range(10)
        ],
        cursor=10,
    )
    state = {"replan_count": 0}
    assert budget_exhausted(state, plan) is True
