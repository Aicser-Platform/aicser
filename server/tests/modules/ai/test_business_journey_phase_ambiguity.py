"""Regression tests: Business OS phase detection must be LLM-driven first,
with the keyword matcher only as a fail-open fallback — not the reverse.

Root cause this guards against: detect_journey_phase() was a pure keyword
classifier reachable whenever supervisor_node's own LLM orchestration call
didn't already decide the phase directly (see business_journey_router_node's
docstring). It had no confirmation step at all, so a query whose wording
happened to match more than one phase's keyword set (e.g. "track progress
and set up alerts" hits both _EXECUTE_KEYWORDS and _MONITOR_KEYWORDS) always
silently won on whichever phase was checked first in a fixed priority order.
User feedback: Auto/adaptive routing in this codebase should be LLM-driven
by default (see feedback_llm_driven_auto_mode memory) — keyword matching is
a fast pre-filter or fail-open fallback, never the primary decision. Fixed
by adding a real function-calling LLM classifier (same conservative,
fail-open shape already proven in skill_executor_node._llm_select_skills_checked)
as the actual decision-maker; the keyword matcher now only fires when the
LLM call is unavailable or fails.
"""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.nodes.business_journey_nodes import detect_journey_phase


def _make_litellm(tool_calls):
    svc = AsyncMock()
    svc.hydrate_user_byok_models = AsyncMock(return_value=None)
    svc.generate_completion_with_tools = AsyncMock(
        return_value={"success": True, "tool_calls": tool_calls, "content": ""}
    )
    return svc


@pytest.mark.asyncio
async def test_llm_classification_is_used_when_available():
    """The LLM's answer wins even when it disagrees with what the keyword
    matcher would have guessed — proving the LLM is the primary decision-maker,
    not just a confirmation step on top of the regex."""
    svc = _make_litellm([{"name": "classify_journey_phase", "arguments": {"phase": "strategy"}}])

    # Wording that a naive keyword matcher would read as "monitor" (contains
    # "set up alerts"), but the LLM decides is actually about strategy.
    phase = await detect_journey_phase("can you help me set up alerts about our market position", {}, svc)

    assert phase == "strategy"
    svc.generate_completion_with_tools.assert_awaited_once()


@pytest.mark.asyncio
async def test_falls_back_to_keyword_matcher_when_llm_unavailable():
    phase = await detect_journey_phase("set up alerts for key kpis", {}, None)
    assert phase == "monitor"


@pytest.mark.asyncio
async def test_falls_back_to_keyword_matcher_when_llm_call_fails():
    svc = AsyncMock()
    svc.hydrate_user_byok_models = AsyncMock(return_value=None)
    svc.generate_completion_with_tools = AsyncMock(side_effect=RuntimeError("provider down"))

    phase = await detect_journey_phase("what are my strategic priorities", {}, svc)

    assert phase == "strategy"


@pytest.mark.asyncio
async def test_ambiguous_keyword_match_degrades_to_assess_when_llm_unavailable():
    phase = await detect_journey_phase("track progress and set up alerts", {}, None)
    assert phase == "assess"


@pytest.mark.asyncio
async def test_llm_call_with_invalid_phase_falls_back_to_keyword_matcher():
    """A malformed/out-of-enum LLM response must not be trusted blindly."""
    svc = _make_litellm([{"name": "classify_journey_phase", "arguments": {"phase": "not_a_real_phase"}}])

    phase = await detect_journey_phase("set up alerts for key kpis", {}, svc)

    assert phase == "monitor"


@pytest.mark.asyncio
async def test_no_keyword_match_defaults_to_assess():
    assert await detect_journey_phase("hello", {}, None) == "assess"
