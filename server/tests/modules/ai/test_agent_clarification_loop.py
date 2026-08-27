"""Kernel clarification loop: verify_goal_semantic can flag genuine user-intent
ambiguity (never technical failures, since it only runs after structural
verification already passed), agent_verifier_node routes to it at most once
per goal, and agent_clarification_node folds an answer back into a fresh
goal-resolution pass or declines gracefully."""

import json

import pytest

from ee.modules.ai.kernel.nodes import (
    agent_clarification_node,
    agent_verifier_node,
    route_after_agent_clarification,
    route_after_agent_verifier,
)
from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType
from ee.modules.ai.kernel.verifier import verify_goal_semantic
from ee.modules.ai.orchestrator.initial_state import build_initial_state
from src.modules.ai.schemas.graph_state import get_retry_state


class FakeLiteLLM:
    def __init__(self, content: str):
        self.content = content
        self.calls: list = []

    async def generate_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True, "content": self.content, "model_used": "mock"}


def _goal(**kwargs) -> AgentGoal:
    defaults = dict(objective="revenue this year", deliverable_type=DeliverableType.chart_analysis)
    defaults.update(kwargs)
    return AgentGoal(**defaults)


@pytest.mark.asyncio
async def test_semantic_verifier_flags_genuine_ambiguity():
    llm = FakeLiteLLM(
        json.dumps(
            {
                "passed": False,
                "reason": "unclear which year",
                "needs_clarification": True,
                "clarifying_question": "Do you mean fiscal year or calendar year?",
                "clarifying_options": ["Fiscal year", "Calendar year"],
            }
        )
    )
    state = {"query": "show revenue this year", "message": "Revenue this year was $1.2M."}
    result = await verify_goal_semantic(_goal(), state, llm)
    assert result is not None
    assert result.passed is False
    assert result.missing_info is not None
    assert result.missing_info.question == "Do you mean fiscal year or calendar year?"
    assert result.missing_info.options == ["Fiscal year", "Calendar year"]


@pytest.mark.asyncio
async def test_semantic_verifier_does_not_flag_technical_failure():
    llm = FakeLiteLLM(
        json.dumps(
            {
                "passed": False,
                "reason": "answer is empty",
                "needs_clarification": False,
                "clarifying_question": "",
                "clarifying_options": [],
            }
        )
    )
    state = {"query": "show revenue this year", "message": "Something went wrong."}
    result = await verify_goal_semantic(_goal(), state, llm)
    assert result is not None
    assert result.missing_info is None


@pytest.mark.asyncio
async def test_semantic_verifier_includes_sql_context_in_prompt():
    llm = FakeLiteLLM(json.dumps({"passed": True, "reason": ""}))
    state = {"query": "revenue by region", "message": "Here it is.", "sql_query": "SELECT region, net_revenue FROM sales"}
    await verify_goal_semantic(_goal(), state, llm)
    assert "net_revenue" in llm.calls[0]["prompt"]


@pytest.mark.asyncio
async def test_agent_verifier_routes_to_clarification_once():
    goal = _goal()
    plan = AgentPlan(
        goal=goal,
        steps=[AgentPlanStep(id="analyze", capability="analytics_pipeline", label="Analyze", status="complete")],
        strategy="test",
        cursor=1,
        version=1,
    )
    llm = FakeLiteLLM(
        json.dumps(
            {
                "passed": False,
                "reason": "ambiguous",
                "needs_clarification": True,
                "clarifying_question": "Which region?",
                "clarifying_options": [],
            }
        )
    )
    state = {
        "query": "revenue by region",
        "message": "Revenue was $1M.",
        "echarts_config": {"type": "bar"},
        "agent_goal": goal.model_dump(),
        "agent_plan": plan.model_dump(),
        "_litellm_service": llm,
        "conversation_id": None,
    }
    out = await agent_verifier_node(state)
    assert out["current_stage"] == "agent_needs_clarification"
    assert out["pending_clarification"]["question"] == "Which region?"
    assert route_after_agent_verifier(out) == "clarify"
    # Shared budget: agent_verifier_node is the decider, so it charges
    # unified_retry_state["clarification"] itself (see clarification_node.py's
    # supervisor-level gate for the other writer of this same counter).
    assert get_retry_state(out).get("clarification") == 1

    # Second time around (clarification already attempted once), the same
    # unresolved ambiguity must NOT ask again - falls through to the existing
    # replan/partial-completion path instead.
    out2 = await agent_verifier_node(out)
    assert out2["current_stage"] != "agent_needs_clarification"


@pytest.mark.asyncio
async def test_clarification_node_folds_answer_and_routes_replan(monkeypatch):
    import langgraph.types as lg_types

    monkeypatch.setattr(lg_types, "interrupt", lambda payload: "the west region")
    state = {
        "query": "revenue by region",
        "pending_clarification": {"question": "Which region?", "options": [], "field_hint": "user_intent"},
    }
    out = await agent_clarification_node(state)
    assert out["current_stage"] == "agent_clarification_resolved"
    assert "the west region" in out["query"]
    assert out["agent_goal"] is None
    assert route_after_agent_clarification(out) == "replan"


@pytest.mark.asyncio
async def test_clarification_node_decline_ends_gracefully(monkeypatch):
    import langgraph.types as lg_types

    monkeypatch.setattr(lg_types, "interrupt", lambda payload: "skip")
    state = {"query": "revenue by region", "pending_clarification": {"question": "Which region?"}}
    out = await agent_clarification_node(state)
    assert out["current_stage"] == "agent_clarification_declined"
    assert route_after_agent_clarification(out) == "end"


def test_new_turn_resets_clarification_attempts():
    """Regression: the clarification budget lives in execution_metadata.unified_retry_state,
    keyed by conversation_id same as retry_count/node_history/etc. A fresh, unrelated
    turn in the same conversation must not inherit a used-up attempt count
    from an earlier goal - otherwise clarification silently stops firing for
    the rest of that conversation after its first use. This budget is shared
    across clarification_node.py (supervisor-level) and the kernel's own
    agent_verifier_node/agent_clarification_node gate."""
    state = build_initial_state(
        litellm_service=object(),
        query="a brand new, unrelated question",
        conversation_id="conv-1",
        user_id="user-1",
        organization_id="org-1",
    )
    assert get_retry_state(state).get("clarification", 0) == 0
