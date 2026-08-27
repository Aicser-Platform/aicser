"""Goal resolver — LLM-primary quiet-mode classification, aligned with supervisor
(no duplicate LLM calls for modes supervisor already confidently classified)."""

import json

import pytest

from ee.modules.ai.kernel.goal_resolver import resolve_goal, resolve_goal_heuristic
from ee.modules.ai.kernel.planner import build_plan
from ee.modules.ai.kernel.schemas import AgentGoal, DeliverableType


class FakeLiteLLM:
    def __init__(self, content: str, success: bool = True):
        self.content = content
        self.success = success
        self.calls: list = []

    async def generate_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": self.success, "content": self.content, "model_used": "mock"}


@pytest.mark.asyncio
async def test_notable_mode_short_circuit_no_duplicate_call():
    """Supervisor already confidently classified this as diagnostic - goal_resolver
    must trust it and make zero LLM calls of its own."""
    llm = FakeLiteLLM(json.dumps({"deliverable_type": "custom", "objective": "x", "success_criteria": []}))
    goal = await resolve_goal(
        {"query": "why did churn spike last quarter", "agent_context": {"analysis_mode": "diagnostic"}},
        litellm_service=llm,
    )
    assert goal.deliverable_type == DeliverableType.chart_analysis
    assert llm.calls == []


def test_notable_mode_regex_divergence_bug_fixed():
    """A diagnostic-classified query that happens to mention 'dashboard' must not
    get silently reclassified as a dashboard-build request by the leftover regex."""
    goal = resolve_goal_heuristic(
        {
            "query": "why did our dashboard KPI drop last week",
            "agent_context": {"analysis_mode": "diagnostic"},
        }
    )
    assert goal.deliverable_type == DeliverableType.chart_analysis


@pytest.mark.asyncio
async def test_quiet_mode_calls_llm_as_primary_classifier():
    """Supervisor spent zero LLM calls on a 'standard'-mode message - goal_resolver's
    own LLM call becomes the primary decision mechanism, not a rare exception."""
    llm = FakeLiteLLM(
        json.dumps(
            {
                "deliverable_type": "custom",
                "objective": "Cross-reference vendor spend against contract terms",
                "success_criteria": ["Flags anomalies"],
            }
        )
    )
    goal = await resolve_goal(
        {
            "query": "cross-reference this quarter's vendor spend against our contract terms",
            "agent_context": {"analysis_mode": "standard"},
        },
        litellm_service=llm,
    )
    assert len(llm.calls) == 1
    assert goal.deliverable_type == DeliverableType.custom


@pytest.mark.asyncio
async def test_trivial_message_fast_path_skips_llm():
    llm = FakeLiteLLM(json.dumps({"deliverable_type": "custom", "objective": "x", "success_criteria": []}))
    goal = await resolve_goal(
        {"query": "thanks", "agent_context": {"analysis_mode": "standard"}},
        litellm_service=llm,
    )
    assert llm.calls == []
    assert goal.deliverable_type == DeliverableType.chart_analysis


@pytest.mark.asyncio
async def test_export_mention_fast_path_skips_llm():
    llm = FakeLiteLLM(json.dumps({"deliverable_type": "custom", "objective": "x", "success_criteria": []}))
    goal = await resolve_goal(
        {"query": "export this as pdf", "agent_context": {"analysis_mode": "standard"}},
        litellm_service=llm,
    )
    assert llm.calls == []
    assert goal.deliverable_type == DeliverableType.export


@pytest.mark.asyncio
async def test_llm_failure_fails_open_to_heuristic():
    """A failed/timed-out LLM call in the new primary path must never leave the
    request with no goal at all - falls back to the heuristic result."""
    llm = FakeLiteLLM(content="", success=False)
    goal = await resolve_goal(
        {
            "query": "cross-reference this quarter's vendor spend against our contract terms",
            "agent_context": {"analysis_mode": "standard"},
        },
        litellm_service=llm,
    )
    assert isinstance(goal, AgentGoal)
    assert goal.deliverable_type == DeliverableType.chart_analysis


@pytest.mark.asyncio
async def test_document_intent_reasoning_wins_over_regex():
    goal = AgentGoal(
        objective="extract the effective date from this contract",  # regex-shaped as extraction
        deliverable_type=DeliverableType.document_extraction,
        document_intent="reasoning",  # but the LLM decided it's actually open-ended reasoning
    )
    plan = await build_plan(
        goal,
        {"query": "extract the effective date from this contract"},
        litellm_service=None,
    )
    assert plan.steps[0].capability == "analyze_document"


@pytest.mark.asyncio
async def test_document_intent_none_falls_back_to_regex():
    goal = AgentGoal(
        objective="summarize this contract",
        deliverable_type=DeliverableType.document_extraction,
        document_intent=None,  # LLM classifier didn't run - fall back to regex
    )
    plan = await build_plan(goal, {"query": "summarize this contract"}, litellm_service=None)
    assert plan.steps[0].capability == "analyze_document"


@pytest.mark.asyncio
async def test_llm_refine_prompt_tells_classifier_a_data_source_is_connected():
    """Regression: "which name has the highest current balance?" (a superlative
    over real rows) was being misclassified as kb_answer and failing with "no
    relevant documents found" - because the classifier prompt only ever saw
    bare query text, with zero signal that a connected SQL data source made
    chart_analysis the obvious answer. The prompt must now tell it so, plus
    list table names when a schema is available, and explicitly steer
    superlative/lookup-shaped wording toward chart_analysis over kb_answer."""
    llm = FakeLiteLLM(json.dumps({"deliverable_type": "chart_analysis", "objective": "x", "success_criteria": []}))
    await resolve_goal(
        {
            "query": "which name has the highest current balance?",
            "agent_context": {"analysis_mode": "standard"},
            "data_source_id": "ds-1",
            "data_source_schema": {"tables": [{"name": "accounts"}, {"name": "customers"}]},
        },
        litellm_service=llm,
    )
    assert len(llm.calls) == 1
    prompt = llm.calls[0]["messages"][1]["content"]
    assert "SQL/structured data source IS connected" in prompt
    assert "accounts" in prompt and "customers" in prompt
    assert "chart_analysis" in prompt
    assert "highest/most" in prompt


@pytest.mark.asyncio
async def test_llm_refine_prompt_notes_absence_of_data_source():
    llm = FakeLiteLLM(json.dumps({"deliverable_type": "kb_answer", "objective": "x", "success_criteria": []}))
    await resolve_goal(
        {"query": "what does our refund policy say?", "agent_context": {"analysis_mode": "standard"}},
        litellm_service=llm,
    )
    assert len(llm.calls) == 1
    prompt = llm.calls[0]["messages"][1]["content"]
    assert "no SQL/structured data source is connected" in prompt
