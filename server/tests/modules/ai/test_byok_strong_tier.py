"""Regression tests: a user's BYOK model must serve the strong/reasoning tier.

Root cause being fixed:
  * ``get_model_for_tier("reasoning")`` returned the default *mini* model whenever
    no dedicated ``azure_reasoning`` deployment existed — it had no awareness of
    BYOK models, so accuracy-critical nodes (nl2sql, error_correction,
    insight_synthesizer) silently ran on a mini model even when the user had a
    BYOK key configured.
  * ``select_structured_model`` preferred a hardcoded list of *_mini ids over the
    user's own BYOK model.

A user who configures a BYOK key has told us their preferred model. It must
serve automatic LLM calls before the platform Azure default unless the user
explicitly selects another model.
"""

import pytest

from ee.modules.ai.services.litellm_service import LiteLLMService
from ee.modules.ai.utils.model_selector import select_structured_model


def _service_with(models: dict, default: str) -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = models
    service.default_model = default
    service.active_model = default
    return service


_MINI = {
    "name": "Azure Mini",
    "model": "azure/gpt-4.1-mini",
    "provider": "azure",
    "tier": "fast",
}
_BYOK_GEMINI = {
    "name": "Gemini (gemini-2.5-flash) — your key",
    "model": "gemini/gemini-2.5-flash",
    "provider": "google",
    "tier": "fast",
    "byok_provider": "google",
}
_AZURE_REASONING = {
    "name": "Azure Reasoning",
    "model": "azure/o1",
    "provider": "azure",
    "tier": "reasoning",
}


# ── get_model_for_tier ────────────────────────────────────────────────────────

def test_reasoning_tier_prefers_byok_over_default_mini():
    svc = _service_with(
        {"azure_gpt41_mini": _MINI, "byok_google": _BYOK_GEMINI},
        default="azure_gpt41_mini",
    )
    assert svc.get_model_for_tier("reasoning") == "byok_google"


def test_reasoning_tier_falls_back_to_default_when_no_byok():
    svc = _service_with({"azure_gpt41_mini": _MINI}, default="azure_gpt41_mini")
    assert svc.get_model_for_tier("reasoning") == "azure_gpt41_mini"


def test_byok_wins_over_dedicated_azure_reasoning():
    svc = _service_with(
        {
            "azure_gpt41_mini": _MINI,
            "azure_reasoning": _AZURE_REASONING,
            "byok_google": _BYOK_GEMINI,
        },
        default="azure_gpt41_mini",
    )
    assert svc.get_model_for_tier("reasoning") == "byok_google"


def test_fast_tier_prefers_byok_over_default():
    svc = _service_with(
        {"azure_gpt41_mini": _MINI, "byok_google": _BYOK_GEMINI},
        default="azure_gpt41_mini",
    )
    assert svc.get_model_for_tier("fast") == "byok_google"


@pytest.mark.asyncio
async def test_auto_model_resolution_prefers_byok_over_default_active_model():
    svc = _service_with(
        {"azure_gpt41_mini": _MINI, "byok_google": _BYOK_GEMINI},
        default="azure_gpt41_mini",
    )
    assert await svc.resolve_working_model_id(None) == "byok_google"
    assert await svc.resolve_working_model_id("auto") == "byok_google"


# ── select_structured_model ───────────────────────────────────────────────────

def test_structured_model_prefers_byok_over_mini_priority_list():
    svc = _service_with(
        {"azure_gpt41_mini": _MINI, "byok_google": _BYOK_GEMINI},
        default="azure_gpt41_mini",
    )
    assert select_structured_model(svc) == "byok_google"


def test_structured_model_honours_explicit_user_selection_over_byok():
    svc = _service_with(
        {
            "azure_gpt41_mini": _MINI,
            "byok_google": _BYOK_GEMINI,
            "openai_gpt4o_mini": dict(_MINI, provider="openai"),
        },
        default="azure_gpt41_mini",
    )
    state = {"execution_metadata": {"model_used": "openai_gpt4o_mini"}}
    assert select_structured_model(svc, state=state) == "openai_gpt4o_mini"


def test_structured_model_falls_back_to_mini_when_no_byok():
    svc = _service_with({"azure_gpt41_mini": _MINI}, default="azure_gpt41_mini")
    assert select_structured_model(svc) == "azure_gpt41_mini"
