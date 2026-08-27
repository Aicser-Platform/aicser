"""Decision briefs and business-health summaries used to read identically to
a CEO and a junior analyst - role_tone_instruction lets a user's chosen
persona (see user_preference_store.get_role_tone_instruction) shape the
system prompt these narrative-synthesis calls send to the LLM."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.decision_os.decision_synthesizer import DecisionSynthesizer


@pytest.mark.asyncio
async def test_synthesize_tactical_appends_role_tone_to_system_prompt():
    captured = {}

    async def fake_node_llm(**kwargs):
        captured["system"] = kwargs.get("system")
        return {"content": "{}", "success": True}

    with patch("ee.modules.ai.services.llm_node_helpers.node_llm", new=fake_node_llm):
        await DecisionSynthesizer().synthesize_tactical(
            query="why did revenue drop",
            analytics_metadata={},
            query_result=[],
            data_source_name="sales_db",
            litellm_service=object(),
            role_tone_instruction="Audience: a senior executive. Keep it short.",
        )

    assert "Audience: a senior executive" in captured["system"]


@pytest.mark.asyncio
async def test_synthesize_tactical_system_prompt_unchanged_when_no_persona_set():
    captured = {}

    async def fake_node_llm(**kwargs):
        captured["system"] = kwargs.get("system")
        return {"content": "{}", "success": True}

    with patch("ee.modules.ai.services.llm_node_helpers.node_llm", new=fake_node_llm):
        await DecisionSynthesizer().synthesize_tactical(
            query="why did revenue drop",
            analytics_metadata={},
            query_result=[],
            data_source_name="sales_db",
            litellm_service=object(),
        )

    assert captured["system"] == "You are a precise enterprise decision-support AI. Return only valid JSON."


@pytest.mark.asyncio
async def test_synthesize_strategic_appends_role_tone_to_system_prompt():
    captured = {}

    async def fake_generate_completion(**kwargs):
        captured["messages"] = kwargs.get("messages")
        return {"success": True, "content": "{}"}

    fake_litellm = AsyncMock()
    fake_litellm.generate_completion = fake_generate_completion

    await DecisionSynthesizer().synthesize_strategic(
        query="what should we do about churn",
        business_snapshot={},
        litellm_service=fake_litellm,
        role_tone_instruction="Audience: a data analyst. Include methodology.",
    )

    system_message = next(m["content"] for m in captured["messages"] if m["role"] == "system")
    assert "Audience: a data analyst" in system_message
