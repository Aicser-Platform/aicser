"""Regression test for a live bug: a plain greeting with a data source
selected got routed into the Agent Kernel's full goal/plan/execute pipeline
instead of a simple conversational reply.

Root cause: should_use_agent_kernel() (goal_resolver.py) has no
conversational/greeting awareness of its own — its docstring assumes an
earlier phase already filtered those out, which is only true when the user
explicitly picks Chat mode (Phase 2.5 in supervisor_node.py, "user selected
Chat mode" -> conversational_end). In auto/standard mode there was no such
filter before the should_use_agent_kernel() call site (supervisor_node.py,
the "Agent Kernel" block), so should_use_agent_kernel() returned True
unconditionally for literally any query with a data source selected -
including "hi".

Live-reproduced against the real orchestrator: sending "hi" with the
Education data source selected (no explicit mode) produced
routing_primary_agent="agent_kernel", the supervisor's own narration read
"I'm analyzing your education to answer 'hi...'", it attempted real SQL
generation, failed repeatedly, tripped the LLM circuit breaker, and took
over 60 seconds before giving up — for a one-word greeting.

Fixed by reusing fast_route_query's own classifier (is_conversational_query,
built on _score_intent, which already scores exact greetings like "hi" as
conversational=5.0/analytic=0.0) as a gate immediately before the
should_use_agent_kernel() call, so an unambiguous greeting/thanks/capability
question short-circuits to Phase 3's normal conversational routing instead
of ever reaching the agentic pipeline — regardless of which analysis mode is
active, not just when Chat mode was explicitly picked.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.supervisor_node import supervisor_node


def _base_state(query: str, **overrides) -> dict:
    state = {
        "query": query,
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds1",
        "data_source_schema": {"tables": [{"name": "grades", "columns": [{"name": "score", "type": "DOUBLE"}]}]},
        "agent_context": {},
    }
    state.update(overrides)
    return state


def _lenient_litellm_service():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})
    return mock


@pytest.mark.asyncio
@pytest.mark.parametrize("greeting", ["hi", "hello", "hey", "hi!", "thanks", "thank you"])
async def test_greeting_with_data_source_never_reaches_agent_kernel(greeting):
    state = _base_state(greeting)
    out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] != "routed_to_agent_kernel"


@pytest.mark.asyncio
async def test_capability_question_with_data_source_never_reaches_agent_kernel():
    state = _base_state("what can you do")
    out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] != "routed_to_agent_kernel"


@pytest.mark.asyncio
async def test_genuine_data_question_with_data_source_is_unaffected():
    """Control case: a real analytical question must still reach real
    analytical routing — the fix must not over-correct into treating every
    query as conversational.

    Updated for should_use_agent_kernel's narrowing (goal_resolver.py): a
    plain single-deliverable question like this one now correctly routes to
    the classic pipeline (routed_to_nl2sql) instead of the kernel, since it
    has no multi-step/multi-deliverable shape — see
    test_genuine_multi_step_data_question_still_reaches_agent_kernel below
    for the control case that confirms the kernel is still reachable when a
    query actually needs it."""
    async def fake_no_match(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    # Phase -1's LLM skill-selection fallback instantiates its own LiteLLMService
    # rather than using the injected mock - without this class-level patch it
    # makes a real, slow LLM call whose tool-fit judgment isn't deterministic,
    # occasionally claiming this generic data question for agent_skills before
    # it ever reaches should_use_agent_kernel.
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_no_match,
    ):
        state = _base_state("show me the average score by grade letter")
        out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] == "routed_to_nl2sql"


@pytest.mark.asyncio
async def test_genuine_multi_step_data_question_still_reaches_agent_kernel():
    """The narrowing in should_use_agent_kernel must not throw out real
    multi-step requests along with the simple ones — same control intent as
    the test above, for a query that actually has multi-step shape."""
    async def fake_no_match(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_no_match,
    ):
        state = _base_state("do a comprehensive end to end analysis of scores by grade letter")
        out = await supervisor_node(state, litellm_service=_lenient_litellm_service())

    assert out["current_stage"] == "routed_to_agent_kernel"
