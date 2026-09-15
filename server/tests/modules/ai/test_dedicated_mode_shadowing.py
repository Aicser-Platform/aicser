"""Regression tests: an explicit (or already confidence-checked) notable
mode selection must not get shadowed by an earlier, softer routing guess
before its own real pipeline ever gets a turn — regardless of whether that
pipeline is a separate dedicated graph or the kernel.

Original bug, two parts, same root cause as the sticky-dashboard-mode fixes
earlier this session:

1. _DEDICATED_PIPELINE_MODES (goal_resolver.py) was missing "executive_report"
   and "business_journey" — both have their own dedicated fast-route branch
   in routing_utils.fast_route_query and their own substantial dedicated node
   pipelines (executive_report_planner_node / business_journey_nodes.py, 982
   lines), exactly like the six modes already excluded (dashboard,
   diagnostic, predictive, prescriptive, animate, decision_intelligence) —
   should_use_agent_kernel's own docstring even says these two used to be
   covered before a refactor silently dropped them. Without the exclusion, an
   explicit Executive Report / Business Journey selection got claimed by the
   generic Agent Kernel goal/plan/execute pass, which had no capability
   equivalent for either — the same "generic text, no real deliverable"
   failure already documented for the other six modes before they were fixed.

2. Phase -1 in supervisor_node.py (skill/export-intent detection) runs BEFORE
   should_use_agent_kernel() and has no mode-awareness of its own — its soft
   export-intent regex or "does this vaguely resemble a configured skill" LLM
   guess could claim a query before the dedicated-pipeline exclusion in bug 1
   even gets a turn. Live-reproduced: "generate an executive report on
   student performance" (explicit executive_report mode) got claimed by an
   unrelated "Alert Investigation" skill here, producing no report at all.
   Fixed by skipping this phase's soft matching entirely once analysis_mode
   is a notable, explicit mode — unless the query carries an explicit
   [Agent Skill: name] marker (the Prompt Library's own unambiguous
   activation syntax), which is a stronger signal than the mode and still
   takes priority.

Kernel-unification roadmap step 1 then removed "executive_report" from
_DEDICATED_PIPELINE_MODES again — deliberately this time, once
_exec_executive_report (capability_registry.py) reached real parity with the
classic graph's report_synthesis -> response_finalizer -> artifact_quality_gate
chain. This exposed that bug 2's fix had been keyed on
_DEDICATED_PIPELINE_MODES membership too — the same set now doing double
duty for two different concerns (which pipeline handles a mode, and whether
Phase -1's soft matcher may touch it), which meant lifting the
executive_report exclusion from concern 1 silently reopened bug 2 for it.
Fixed by re-keying Phase -1's protection on goal_resolver._is_notable_mode
instead — the actual property that matters ("the user made a confident,
explicit choice") is independent of which pipeline downstream honors it.

Step 2 then removed diagnostic/predictive/prescriptive/animate too, once
_exec_analytics_pipeline/_exec_visualize reached parity via the same
response_finalizer gate. Unlike executive_report, these four never had a
standalone priority-ladder branch in supervisor_node.py (confirmed via
source scan before removing them) — they route through nl2sql/analytics_node
via the shared primary_agent="agent_kernel" path with analytics_type
distinguishing the engine, so no ladder fix was needed for them, only the
_DEDICATED_PIPELINE_MODES removal itself.

decision_intelligence, dashboard, and business_journey remain excluded and
unaffected by either step.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.goal_resolver import _DEDICATED_PIPELINE_MODES, _is_notable_mode, should_use_agent_kernel
from ee.modules.ai.nodes.supervisor_node import supervisor_node


def test_business_journey_is_excluded_executive_report_is_not():
    assert "executive_report" not in _DEDICATED_PIPELINE_MODES
    assert "business_journey" in _DEDICATED_PIPELINE_MODES


def test_diagnostic_predictive_prescriptive_animate_are_not_excluded():
    for mode in ("diagnostic", "predictive", "prescriptive", "animate"):
        assert mode not in _DEDICATED_PIPELINE_MODES, mode


def test_decision_intelligence_and_dashboard_remain_excluded():
    assert "decision_intelligence" in _DEDICATED_PIPELINE_MODES
    assert "dashboard" in _DEDICATED_PIPELINE_MODES


def test_should_use_agent_kernel_declines_simple_queries_in_all_four_analytics_engine_modes():
    """Confirms these four have no MODE-level kernel exclusion (they're not
    in _DEDICATED_PIPELINE_MODES, per test_diagnostic_predictive_prescriptive_
    animate_are_not_excluded above) — a plain single-query request in any of
    them now declines kernel routing on the QUERY-COMPLEXITY gate
    (is_multi_step_request) instead, same as "standard"/"auto" mode. See
    test_should_use_agent_kernel_still_routes_multi_step_requests_in_all_four_
    analytics_engine_modes below for confirmation the mode itself still isn't
    what's blocking them."""
    for mode in ("diagnostic", "predictive", "prescriptive", "animate"):
        state = {"query": "why did this happen", "data_source_id": "ds-1", "agent_context": {"analysis_mode": mode}}
        assert should_use_agent_kernel(state) is False, mode


def test_should_use_agent_kernel_still_routes_multi_step_requests_in_all_four_analytics_engine_modes():
    for mode in ("diagnostic", "predictive", "prescriptive", "animate"):
        state = {
            "query": "do a comprehensive end to end analysis of why this happened",
            "data_source_id": "ds-1",
            "agent_context": {"analysis_mode": mode},
        }
        assert should_use_agent_kernel(state) is True, mode


def test_executive_report_is_still_a_notable_mode():
    """The property Phase -1's shadowing protection actually depends on must
    still hold for executive_report even though it left
    _DEDICATED_PIPELINE_MODES."""
    assert _is_notable_mode("executive_report") is True


def test_should_use_agent_kernel_routes_executive_report_declines_business_journey():
    state = {"query": "generate a report", "data_source_id": "ds-1", "agent_context": {"analysis_mode": "executive_report"}}
    assert should_use_agent_kernel(state) is True

    state = {"query": "generate a report", "data_source_id": "ds-1", "agent_context": {"analysis_mode": "business_journey"}}
    assert should_use_agent_kernel(state) is False


def _base_state(query: str, analysis_mode: str, **overrides) -> dict:
    state = {
        "query": query,
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds1",
        "data_source_schema": {"tables": [{"name": "grades", "columns": [{"name": "score", "type": "DOUBLE"}]}]},
        "agent_context": {"analysis_mode": analysis_mode},
    }
    state.update(overrides)
    return state


def _lenient_litellm_service():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})
    mock.generate_completion_with_tools = AsyncMock(
        return_value={"success": True, "tool_calls": [{"name": "some_skill", "arguments": {}}]}
    )
    return mock


@pytest.mark.asyncio
async def test_explicit_executive_report_mode_reaches_agent_kernel_not_skills():
    """The shadowing protection must still hold — an explicit executive_report
    selection must not get claimed by the soft skill-matcher — but the
    destination is now agent_kernel (not a separate dedicated pipeline),
    since _exec_executive_report reached parity with the classic graph's
    chain (kernel-unification roadmap step 1)."""
    litellm = _lenient_litellm_service()
    state = _base_state("generate an executive report on student performance", "executive_report")
    out = await supervisor_node(state, litellm_service=litellm)

    assert out["current_stage"] == "routed_to_agent_kernel"
    assert out["current_stage"] != "routed_to_agent_skills"
    # The soft skill-matcher must never even have been asked — not just that
    # its (mocked, would-be-wrong) answer was discarded.
    litellm.generate_completion_with_tools.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_business_journey_mode_never_reaches_agent_kernel_or_skills():
    litellm = _lenient_litellm_service()
    state = _base_state("help me assess my business", "business_journey")
    out = await supervisor_node(state, litellm_service=litellm)

    assert out["current_stage"] != "routed_to_agent_kernel"
    assert out["current_stage"] != "routed_to_agent_skills"
    # Unlike the skill-matcher (above), detect_journey_phase() is now
    # intentionally LLM-first (user preference: adaptive routing should be
    # LLM-driven by default, keyword matching only as a fail-open fallback —
    # see business_journey_nodes._llm_classify_journey_phase) — a real
    # phase-classification call IS expected here, it just isn't shaped like
    # this generic mock's "some_skill" tool call, so detect_journey_phase()
    # correctly falls back to its own keyword matcher for the final answer.
    litellm.generate_completion_with_tools.assert_awaited()


@pytest.mark.asyncio
async def test_explicit_agent_skill_marker_still_wins_even_in_a_dedicated_mode():
    """Control case: the Prompt Library's own explicit activation syntax is a
    stronger, unambiguous signal than the mode and must still work.

    Patch target note, found live while verifying this exact test: Phase -1's
    hit-confirmation step (_llm_select_skills_checked, skill_executor_node.py)
    builds its own LiteLLMService() internally rather than using the
    litellm_service DI parameter supervisor_node() receives, so mocking that
    parameter alone (_lenient_litellm_service()) never reaches this call —
    confirmed via direct instrumentation: the regex-matched "weekly_summary"
    step was correctly produced, then silently cleared to [] by this
    unreachable-mock confirmation step, leaving _routed False and letting the
    query fall through to agent_kernel instead. Patching
    skill_executor_node._llm_select_skills_checked directly sidesteps that DI
    gap to test Phase -1's mode-shadowing logic in isolation.
    """
    state = _base_state(
        "[Agent Skill: weekly_summary] give me the weekly summary",
        "executive_report",
    )
    confirm_mock = AsyncMock(return_value=([{"id": "weekly_summary", "type": "skill", "skill": "weekly_summary"}], True))
    with patch("ee.modules.ai.nodes.skill_executor_node._llm_select_skills_checked", confirm_mock):
        out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] == "routed_to_agent_skills"


@pytest.mark.asyncio
async def test_non_dedicated_mode_soft_skill_matching_is_unaffected():
    """Control case: ordinary standard-mode queries must keep going through
    the existing soft skill-matching path unchanged.

    Same _llm_select_skills_checked DI-bypass as the test above — see that
    test's docstring."""
    litellm = _lenient_litellm_service()
    state = _base_state("export this as a pdf", "standard")
    confirm_mock = AsyncMock(return_value=([{"id": "generate_pdf", "type": "skill", "skill": "generate_pdf"}], True))
    with patch("ee.modules.ai.nodes.skill_executor_node._llm_select_skills_checked", confirm_mock):
        out = await supervisor_node(state, litellm_service=litellm)

    assert out["current_stage"] == "routed_to_agent_skills"
