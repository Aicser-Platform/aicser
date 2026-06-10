"""Tests for enterprise agent policy and assess services."""
import pytest

from ee.modules.ai.services.action_policy_engine import (
    ActionRiskTier,
    evaluate_action,
    get_action_tier,
    requires_approval,
)
from ee.modules.ai.services.assess_service import is_assess_intent, build_assess_execution_plan
from ee.modules.ai.nodes.action_executor_node import project_agent_plan_to_execution_plan


def test_get_action_tier_defaults():
    assert get_action_tier("run_sql") == ActionRiskTier.L0_AUTO
    assert get_action_tier("create_alert") == ActionRiskTier.L2_CONFIRM
    assert get_action_tier("ddl") == ActionRiskTier.L3_DENY


def test_evaluate_action_l2_requires_approval():
    allowed, reason, tier = evaluate_action("create_alert", approved=False)
    assert not allowed
    assert tier == ActionRiskTier.L2_CONFIRM
    assert "approval" in reason.lower()

    allowed2, _, _ = evaluate_action("create_alert", approved=True)
    assert allowed2


def test_evaluate_action_l0_auto():
    allowed, _, tier = evaluate_action("run_sql")
    assert allowed
    assert tier == ActionRiskTier.L0_AUTO


def test_requires_approval():
    assert requires_approval("create_alert") is True
    assert requires_approval("save_chart") is False


def test_is_assess_intent():
    assert is_assess_intent("Assess our current business state")
    assert is_assess_intent("Where are we on revenue goals?")
    assert not is_assess_intent("Show me a bar chart of sales")


def test_build_assess_plan():
    plan = build_assess_execution_plan()
    assert len(plan) >= 4
    assert plan[0]["id"] == "profile"


def test_project_agent_plan_to_execution_plan():
    agent_plan = {
        "steps": [
            {"id": "a1", "type": "skill", "skill": "create_alert", "status": "pending"},
            {"id": "a2", "type": "skill", "skill": "save_chart", "status": "completed"},
        ]
    }
    steps = project_agent_plan_to_execution_plan(agent_plan)
    assert len(steps) == 2
    assert steps[0]["label"] == "Create alert rule"
    assert steps[1]["status"] == "complete"
