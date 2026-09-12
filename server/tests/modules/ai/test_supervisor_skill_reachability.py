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
    """A real LiteLLMService instance (not a generic AsyncMock) with generate_completion
    wired to fail loudly if actually invoked.

    Must be a real instance, not a disconnected mock: _llm_select_skills_checked reuses
    whatever `litellm_service` it's given rather than always building a fresh one (see its
    own "PERFORMANCE" doc comment) - Phase -1 passes this exact object straight through to
    `generate_completion_with_tools`. A plain `AsyncMock()` has no relationship to the real
    LiteLLMService class, so every test's `patch("...LiteLLMService.generate_completion_with_tools",
    ...)` silently never fired through it - the call landed on an unconfigured, unspecced
    mock attribute instead, raised (awaiting a non-awaitable default return), and got
    swallowed by _llm_select_skills_checked's own except-and-fail-open, making Phase -1 look
    like it always failed/abstained regardless of what a test's fake function returned. A
    real instance picks up class-level patches through normal attribute lookup, exactly like
    the class's own callers do."""
    from ee.modules.ai.services.litellm_service import LiteLLMService

    instance = LiteLLMService()
    instance.generate_completion = AsyncMock(side_effect=AssertionError("litellm_service should not be called"))
    return instance


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
    """Auto composer questions must not be hijacked by the run_sql miss-fallback.

    The LLM still claims run_sql as a 'clear fit' for almost any data question.
    Auto/Analyze/Descriptive skip that miss-fallback so they reach nl2sql →
    chart → insight_synthesizer. Export regex and [Agent Skill:] stay intact.
    """
    async def fake_generate_completion_with_tools(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "run_sql" for t in tools)
        return {"success": True, "tool_calls": [{"name": "run_sql", "arguments": {}}], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_generate_completion_with_tools,
    ):
        state = _base_state("can you dig into this for me")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] != "routed_to_agent_skills"
    assert (out.get("agent_plan") or {}).get("trigger") != "llm_selection"


@pytest.mark.asyncio
async def test_auto_data_question_does_not_route_to_run_sql_skill():
    async def fake_claims_run_sql(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [{"name": "run_sql", "arguments": {}}], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_claims_run_sql,
    ):
        state = _base_state("how many customers per month over time")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] != "routed_to_agent_skills"
    em = out.get("execution_metadata") or {}
    assert em.get("needs_narrative") is True
    assert em.get("needs_chart") is True


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
async def test_regex_match_gets_llm_confirmation_and_agreement_keeps_routing():
    """A regex match is no longer trusted blindly (see the false-positive tests
    below) - it now gets a confirmation call through the same conservative LLM
    selector. When the LLM independently agrees a skill fits, routing proceeds
    exactly as before, just with one extra (cheap, narrow-path) call."""
    called = {"llm": False}

    async def fake_confirms(self, prompt, system_context, tools, **kwargs):
        called["llm"] = True
        assert any(t["function"]["name"] == "generate_pdf" for t in tools)
        return {"success": True, "tool_calls": [{"name": "generate_pdf", "arguments": {}}], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_confirms,
    ):
        state = _base_state("export this as a pdf report")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"
    assert called["llm"] is True


@pytest.mark.asyncio
async def test_regex_false_positive_discarded_when_llm_confirmation_disagrees():
    """Reproduces a live bug: a user's KB follow-up question -- "What else does
    ABA_FY2024_Audited_FS-EN.pdf say about this topic?" -- got hijacked into a
    content-less PDF export because the regex matched the ".pdf" extension
    inside the referenced filename (separately fixed at the regex level with a
    lookbehind guard in nodes/planner_node.py - this test simulates the regex
    still matching something, via a query the guard doesn't cover, to exercise
    this second, independent safety net). When the LLM confirmation
    independently finds no skill fits, the regex's match must be discarded and
    routing must fall through to normal (non-skills) routing, exactly as if
    the regex had found nothing to begin with."""
    async def fake_disagrees(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_disagrees,
    ):
        # "excel" is a bare format word (matches _EXPORT_PATTERNS) inside a
        # sentence that isn't actually an export request - a stand-in for any
        # regex-hit-but-wrong case the confirmation layer exists to catch.
        state = _base_state("what happened to our excel-based reporting process last year")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] != "routed_to_agent_skills"


@pytest.mark.asyncio
async def test_confirmation_failure_fails_open_and_keeps_regex_routing():
    """A broken/unavailable LLM provider during the confirmation call must
    never be able to block a request that the regex already had a concrete
    answer for - matching the fail-open design of every other confidence
    check in this codebase (routing_utils.check_notable_mode_confidence)."""
    async def fake_raises(self, prompt, system_context, tools, **kwargs):
        raise RuntimeError("provider unavailable")

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_raises,
    ):
        state = _base_state("export this as a pdf report")
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"


@pytest.mark.asyncio
async def test_export_request_not_hijacked_by_sticky_dashboard_context():
    """Live-reproduced bug: sending "Export this dashboard as a PowerPoint
    presentation" while an existing dashboard was the active/sticky chat target
    (target_dashboard_id set) got routed into dashboard-lifecycle "refine"
    instead of the correctly-matched generate_pptx agent skill. Phase -1 (above)
    found the right route and set primary_agent="agent_skills", but the sticky-
    dashboard block further down in the "Build Execution Plan" ladder used to run
    detect_dashboard_lifecycle_action() unconditionally whenever a dashboard was
    sticky - that heuristic only knows "a dashboard is open" + its own keyword
    guesses (its mentions_board catch-all matches on the literal word "dashboard"
    appearing anywhere in the query), so it reclassified the same export request
    as a board edit and silently discarded the correct, already-confirmed skill
    route - sending the request into the dashboard-edit LLM instead, which
    hallucinated a bogus, unbound widget for a sentence that was never an edit
    instruction to begin with. An explicit, already-confirmed agent_skills route
    from Phase -1 must never be shadowed by this softer heuristic."""
    async def fake_confirms(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "generate_pptx" for t in tools)
        return {
            "success": True,
            "tool_calls": [{"name": "generate_pptx", "arguments": {}}],
            "content": "",
        }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_confirms,
    ):
        state = _base_state("Export this dashboard as a PowerPoint presentation")
        state["target_dashboard_id"] = "dash-1"
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"
    assert out["agent_plan"]["steps"][0]["skill"] == "generate_pptx"
    assert out.get("dashboard_lifecycle_action") is None


@pytest.mark.asyncio
async def test_export_request_wins_even_against_a_hard_lifecycle_keyword_match():
    """Narrower isolation of the fix above: detect_dashboard_lifecycle_action's
    HARD keyword lists (_UPDATE_KEYWORDS here, via the literal phrase "refresh
    this dashboard") are a separate, more confident code path than the soft
    mentions_board catch-all - so even a query that trips one of those exact
    phrases, while also being a Phase -1-confirmed export skill match, must
    still route to the skill. Proves the guard is keyed on "Phase -1 already
    decided agent_skills", not on which part of detect_dashboard_lifecycle_action
    would have fired."""
    async def fake_confirms(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "generate_pdf" for t in tools)
        return {
            "success": True,
            "tool_calls": [{"name": "generate_pdf", "arguments": {}}],
            "content": "",
        }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_confirms,
    ):
        state = _base_state("refresh this dashboard and export it as a pdf")
        state["target_dashboard_id"] = "dash-1"
        out = await supervisor_node(state, litellm_service=_unused_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"
    assert out["agent_plan"]["steps"][0]["skill"] == "generate_pdf"


@pytest.mark.asyncio
async def test_agent_kernel_routing_reachable():
    """A multi-step request's routing_decision must survive all the way to
    current_stage - previously it was silently overwritten by the Build Execution
    Plan ladder's routed_to_nl2sql default, making the entire agent_kernel pipeline
    unreachable in practice.

    Updated for should_use_agent_kernel's narrowing (goal_resolver.py): this test's
    original query, "show revenue by month as a bar chart", is a plain single-
    deliverable request and now correctly declines kernel routing (see
    test_agent_kernel.py's is_multi_step_request tests) - it's swapped here for a
    genuinely multi-step query so this test still exercises what it's named for
    (ladder reachability), not should_use_agent_kernel's own decision logic."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    async def fake_no_match(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    # Phase -1's LLM skill-selection fallback reuses the injected `litellm_service`
    # (see _unused_litellm_service's docstring above) - without this class-level
    # patch it makes a real, slow LLM call that isn't reliably conservative,
    # nondeterministically claiming this query for agent_skills before it ever
    # reaches should_use_agent_kernel.
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_no_match,
    ):
        state = _base_state("do a comprehensive end to end analysis of revenue by month and show it as a bar chart")
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

    Kernel-unification roadmap step 1 has since closed that gap the other way:
    executive_report's capability reached parity in capability_registry.py, so the
    standalone executive_report ladder branch was removed entirely and it now
    deliberately falls through to (and is genuinely handled by) agent_kernel - this
    pins that it isn't shadowed by, but *is*, the kernel route."""
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("give me a full report on this quarter's performance")
    state["agent_context"] = {"analysis_mode": "executive_report"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["current_stage"] == "routed_to_agent_kernel"
    assert out["execution_metadata"]["analysis_mode"] == "executive_report"


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
    the agent kernel's own "Next, I am planning execution." plan and a
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
