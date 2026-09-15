"""strategy_analysis_node's message used to unconditionally claim "I've outlined
3 strategic paths above" regardless of how many options synthesize_strategic
actually returned - including when it returned zero (its own documented fail-open
behavior on any LLM/parse error: empty options list, blank recommended_strategy).
Live-reproduced: a Business OS "build a strategy" request rendered a confident-
sounding "assessment ready" / "outlined 3 paths above" message with no options
card and no real content above it at all - the reAct-style loop never verified
its own synthesis step actually produced something before declaring success."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.business_journey_nodes import strategy_analysis_node


def _state():
    return {
        "query": "Build a strategy to capture my top opportunities",
        "user_id": "u1",
        "organization_id": None,
        "data_source_name": "Sample: Banking",
        "business_state_snapshot": {
            "top_opportunities": ["Grow SME lending"],
            "top_risks": ["Deposit concentration"],
            "health_score": 62,
            "executive_summary": "Healthy growth, moderate risk.",
        },
        "agent_context": {},
    }


@pytest.mark.asyncio
async def test_message_reflects_actual_option_count_not_hardcoded_three():
    two_options = [{"label": "Defensive"}, {"label": "Balanced"}]
    with patch(
        "ee.modules.decision_os.decision_synthesizer.DecisionSynthesizer.synthesize_strategic",
        new=AsyncMock(return_value={
            "options": two_options,
            "recommended_strategy": "Focus on SME lending growth.",
            "situation_analysis": "Solid footing.",
            "next_step": "Prioritise SME outreach.",
        }),
    ):
        state = await strategy_analysis_node(_state())

    assert "2 strategic paths" in state["message"]
    assert "3 strategic paths" not in state["message"]
    assert state["strategic_options"] == two_options


@pytest.mark.asyncio
async def test_single_option_uses_singular_path():
    with patch(
        "ee.modules.decision_os.decision_synthesizer.DecisionSynthesizer.synthesize_strategic",
        new=AsyncMock(return_value={
            "options": [{"label": "Only option"}],
            "recommended_strategy": "Do the one thing.",
        }),
    ):
        state = await strategy_analysis_node(_state())

    assert "1 strategic path " in state["message"] or state["message"].count("strategic path") == 1
    assert "strategic paths" not in state["message"]


@pytest.mark.asyncio
async def test_empty_options_gets_honest_failure_message_not_fake_success():
    """synthesize_strategic's own documented fail-open case: LLM/parse error ->
    empty options, blank recommended_strategy. The node must not claim it
    "outlined" paths that don't exist."""
    with patch(
        "ee.modules.decision_os.decision_synthesizer.DecisionSynthesizer.synthesize_strategic",
        new=AsyncMock(return_value={
            "options": [],
            "recommended_strategy": "",
            "situation_analysis": "",
            "decision_confidence": "medium",
            "confidence_score": 0.55,
        }),
    ):
        state = await strategy_analysis_node(_state())

    assert "outlined" not in state["message"].lower()
    assert "wasn't able to generate" in state["message"]
    assert state["strategic_options"] == []
