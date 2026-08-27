"""Regression tests for supervisor_node routing-decision reachability.

Two related bugs, same root cause and same fix shape:

1. Phase -1 skill routing: skill_executor_node's LLM-driven `_llm_select_skills`
   fallback could only ever run *after* supervisor_node's own regex
   (`_infer_plan_steps`) had already found a match — but that regex match was the
   only thing that ever routed a query into skill_executor_node in the first place.
   Fixed by giving the model a real, function-calling look in Phase -1 when the
   regex finds nothing.

2. Both that Phase -1 decision AND the pre-existing agent_kernel decision
   (`should_use_agent_kernel()`, which returns True by default for nearly every
   request — it's the intended universal routing path) were being silently
   discarded later in supervisor_node's "PHASE 3: Build Execution Plan" ladder:
   that ladder unconditionally re-derives `state["current_stage"]` from
   `primary_agent`, and had no case at all for "agent_skills" or "agent_kernel" -
   so both routes fell through to whatever the ladder's other heuristics guessed
   (e.g. routed_to_executive_report for any query containing "report", or the
   routed_to_nl2sql default otherwise), even though the correct routing_decision
   was already sitting in state. Fixed by adding matching cases to that ladder,
   the same way rag/nl2sql/dashboard already re-affirm their own decisions there.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.supervisor_node import supervisor_node


def _unused_litellm_service():
    """A litellm_service double that fails loudly if actually invoked. Phase -1 runs
    immediately after the `data_source_id` check (before any conversational/mode-confidence
    LLM call), and `_llm_select_skills` instantiates its own LiteLLMService rather than
    using this one - so this object should never be called in any of these tests."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(side_effect=AssertionError("litellm_service should not be called"))
    return mock


def _base_state(query: str) -> dict:
    """supervisor_node short-circuits straight to conversational mode when
    `data_source_id` is falsy (PHASE 1, before Phase -1 ever runs) - so a data source
    must be present in state for these Phase -1 skill-routing tests to exercise
    anything beyond that early return."""
    return {
        "query": query,
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds1",
        "data_source_schema": {"tables": []},
        "agent_context": {"analysis_mode": "auto"},
    }


@pytest.mark.asyncio
async def test_llm_skill_selection_reachable_when_regex_finds_nothing():
    async def fake_generate_completion_with_tools(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "run_sql" for t in tools)
        return {"success": True, "tool_calls": [{"name": "run_sql", "arguments": {}}], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_generate_completion_with_tools,
    ):
        state = _base_state("can you dig into this for me")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"
    assert out["agent_plan"]["trigger"] == "llm_selection"
    assert out["agent_plan"]["steps"][0]["skill"] == "run_sql"


@pytest.mark.asyncio
async def test_no_skill_match_falls_through_to_normal_routing_unchanged():
    """When both regex and the LLM abstain, routing must proceed exactly as before -
    this must never get stuck on or hijacked by the new Phase -1 LLM check."""
    async def fake_no_match(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_no_match,
    ):
        state = _base_state("hello there, how are you")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] != "routed_to_agent_skills"
    assert not (out.get("agent_plan") or {}).get("trigger") == "llm_selection"


@pytest.mark.asyncio
async def test_llm_skill_selection_not_consulted_when_regex_already_matched():
    """Regex-matched requests (export/report keywords, explicit tag) must not pay for
    an extra LLM call - Phase -1 should only reach the new LLM check when _infer_plan_steps
    returns nothing."""
    called = {"llm": False}

    async def fake_should_not_be_called(self, prompt, system_context, tools, **kwargs):
        called["llm"] = True
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_should_not_be_called,
    ):
        state = _base_state("export this as a pdf report")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"
    assert called["llm"] is False


@pytest.mark.asyncio
async def test_agent_kernel_routing_reachable():
    """should_use_agent_kernel() returns True by default for any data-source query,
    so its routing_decision must survive all the way to current_stage - previously
    it was silently overwritten by the Build Execution Plan ladder's routed_to_nl2sql
    default, making the entire agent_kernel pipeline unreachable in practice."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("show revenue by month as a bar chart")
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_agent_kernel"


@pytest.mark.asyncio
async def test_executive_report_not_shadowed_by_agent_kernel():
    """A DB-connected (non-file) data source with analysis_mode=executive_report used
    to lose every time to the agent_kernel re-affirmation below it in the same
    elif-chain: should_use_agent_kernel() sets primary_agent="agent_kernel" in the
    Phase -1-ish early block regardless of analysis_mode (it doesn't consult it), and
    the executive_report elif in the "Build Execution Plan" ladder was checked AFTER
    the agent_kernel elif — so it could never fire once agent_kernel already matched.
    Unlike dashboard/business_journey (which get independent priority checks earlier
    in that same ladder, keyed off analysis_mode rather than primary_agent),
    executive_report had no such protection. Fixed by reordering the executive_report
    elif before the agent_kernel one, mirroring dashboard/business_journey's immunity."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("give me a full report on this quarter's performance")
    state["agent_context"] = {"analysis_mode": "executive_report"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_executive_report"


@pytest.mark.asyncio
async def test_decision_intelligence_not_shadowed_by_agent_kernel():
    """Same shadowing bug as executive_report's, one layer earlier: the Agent Kernel
    block runs before Phase 3b even checks analysis_mode == "decision_intelligence",
    and should_use_agent_kernel() returns True for nearly any data-source query - so
    a decision_intelligence request was claimed by agent_kernel before Phase 3b ever
    got a chance, silently running the generic goal/plan loop instead of the
    diagnostic+predictive+prescriptive pipeline that feeds a Decision Brief (confirmed:
    analytics_type stayed "descriptive", not "diagnostic_prescriptive_predictive").
    Fixed by excluding decision_intelligence from the Agent Kernel block's condition,
    the same way dashboard already steps aside before that block runs."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("why did churn spike and what should we do about it")
    state["agent_context"] = {"analysis_mode": "decision_intelligence"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_nl2sql"
    assert out["analytics_type"] == "diagnostic_prescriptive_predictive"
    assert out["execution_metadata"]["analysis_mode"] == "decision_intelligence"


@pytest.mark.asyncio
async def test_explicit_animate_mode_not_shadowed_by_agent_kernel():
    """Live-reproduced bug: selecting "Animate" mode and asking a question produced
    the agent kernel's own "Next, I am planning autonomous execution." plan and a
    bare partial SQL result - never an animated chart. Same root cause as Decide's:
    should_use_agent_kernel() has no exclusion for any mode, so an explicit
    diagnostic/predictive/prescriptive/animate selection was claimed by agent_kernel
    before the dedicated "user explicitly chose X" fast paths (which build a real
    delegation_context and run analytics_node's actual engines via nl2sql) ever got
    a turn. Fixed the same way: excluded from the Agent Kernel block's condition."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("how many customers monthly over brand")
    state["agent_context"] = {"analysis_mode": "animate", "analytics_type": "animate"}
    state["analytics_type"] = "animate"
    # Isolates the routing decision from animate's own (legitimate, separate)
    # field-disambiguation clarification prompt, which an empty test schema would
    # otherwise trigger regardless of which pipeline was going to handle the request.
    state["clarification_response"] = {"resolved": True}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_nl2sql"
    assert out["analytics_type"] == "animate"
    assert out["execution_metadata"]["analysis_mode"] == "animate"


@pytest.mark.asyncio
async def test_explicit_diagnostic_mode_not_shadowed_by_agent_kernel():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("why did revenue drop last month")
    state["agent_context"] = {"analysis_mode": "diagnostic", "analytics_type": "diagnostic"}
    state["analytics_type"] = "diagnostic"
    state["clarification_response"] = {"resolved": True}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_nl2sql"
    assert out["analytics_type"] == "diagnostic"
