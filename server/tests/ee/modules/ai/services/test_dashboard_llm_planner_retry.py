"""Regression test: the dashboard LLM planning call retries once on a
transient failure before accepting the deterministic heuristic fallback.

Root cause: a single dropped connection or rate-limit blip on the LLM
refinement call silently downgraded dashboard insight quality to the
heuristic seed, with no attempt to recover first — the same class of
"quality loss the user never sees a signal for" already fixed elsewhere
this session (the honesty note added when used_llm=False). This closes the
gap one layer earlier: give the LLM path a real second chance before
reaching for the fallback at all.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan
from ee.modules.ai.schemas.dashboard_plan import DashboardLLMPlan


def _seed():
    return DashboardLLMPlan(dashboard_title="Seed Dashboard", dashboard_subtitle="", pages=[])


@pytest.mark.asyncio
async def test_retries_once_then_succeeds():
    calls = {"n": 0}

    async def fake_completion(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient provider error")
        return {
            "success": True,
            "content": '{"dashboard_title": "Recovered Dashboard", "dashboard_subtitle": "", "pages": []}',
        }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(side_effect=fake_completion),
    ), patch("asyncio.sleep", new=AsyncMock()):
        result = await _llm_refine_dashboard_plan(
            _seed(),
            prompt="test",
            schema_summary="",
            data_source_name="Test",
            tables_info=[],
            model_id=None,
            semantic_hints="",
            table_name="t",
            grounding_block="",
        )

    assert calls["n"] == 2
    assert result.used_llm is True
    assert result.dashboard_title == "Recovered Dashboard"


@pytest.mark.asyncio
async def test_falls_back_to_seed_after_both_attempts_fail():
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(side_effect=RuntimeError("still down")),
    ), patch("asyncio.sleep", new=AsyncMock()):
        result = await _llm_refine_dashboard_plan(
            _seed(),
            prompt="test",
            schema_summary="",
            data_source_name="Test",
            tables_info=[],
            model_id=None,
            semantic_hints="",
            table_name="t",
            grounding_block="",
        )

    assert result.used_llm is False
    assert result.dashboard_title == "Seed Dashboard"


@pytest.mark.asyncio
async def test_succeeds_on_first_attempt_does_not_retry():
    mock_completion = AsyncMock(
        return_value={
            "success": True,
            "content": '{"dashboard_title": "First Try", "dashboard_subtitle": "", "pages": []}',
        }
    )
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=mock_completion,
    ):
        result = await _llm_refine_dashboard_plan(
            _seed(),
            prompt="test",
            schema_summary="",
            data_source_name="Test",
            tables_info=[],
            model_id=None,
            semantic_hints="",
            table_name="t",
            grounding_block="",
        )

    assert mock_completion.await_count == 1
    assert result.used_llm is True
