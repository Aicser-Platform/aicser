"""Regression tests: OPENROUTER_API_KEY registers a curated set of DeepSeek
V4 Flash/Pro and Z.ai GLM-5.3/GLM-5.3-Flash models -- giving the "reasoning"
tier real alternatives to the single hardcoded platform_reasoning route
(Mimo v2.5), and the "fast" tier a second option beyond primary_override.

Additive only: platform_reasoning/primary_override, when configured, still
win priority in get_model_for_tier -- these are extra candidates the
existing fallback chain (get_fallback_model_id, including its
requires_vision awareness) and explicit model selection can reach, not a
replacement for the operator's chosen defaults.
"""

import os

import pytest

from ee.modules.ai.services.litellm_service import LiteLLMService


def _clear_provider_env(monkeypatch):
    """Isolate from whatever the real environment (or a prior test in the
    same process) happens to have set for provider credentials."""
    for key in (
        "OPENROUTER_API_KEY",
        "PRIMARY_MODEL_PROVIDER",
        "REASONING_MODEL_PROVIDER",
        "AZURE_OPENAI_API_KEY",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)


def test_no_openrouter_key_registers_nothing():
    service = LiteLLMService()
    assert "openrouter_deepseek_flash" not in service.available_models
    assert "openrouter_glm_pro" not in service.available_models


def test_openrouter_key_registers_all_four_curated_models(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-key")

    service = LiteLLMService()

    expected = {
        "openrouter_deepseek_flash": ("openrouter/deepseek/deepseek-v4-flash", "fast", False),
        "openrouter_deepseek_pro": ("openrouter/deepseek/deepseek-v4-pro", "reasoning", False),
        "openrouter_glm_flash": ("openrouter/z-ai/glm-5.3-flash", "fast", True),
        "openrouter_glm_pro": ("openrouter/z-ai/glm-5.3", "reasoning", True),
    }
    for key, (model_str, tier, vision) in expected.items():
        assert key in service.available_models, f"{key} not registered"
        cfg = service.available_models[key]
        assert cfg["model"] == model_str
        assert cfg["tier"] == tier
        assert cfg["supports_vision"] is vision
        assert cfg["api_key"] == "sk-or-fake-key"
        assert cfg["provider"] == "openrouter"


def test_openrouter_glm_pro_is_a_reasoning_tier_fallback_candidate(monkeypatch):
    """get_model_for_tier's step-2 scan (any config with tier=="reasoning")
    must be able to reach the new GLM/DeepSeek Pro entries when
    platform_reasoning isn't the one selected (e.g. removed from
    available_models to simulate it being unavailable)."""
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-key")

    service = LiteLLMService()
    service.active_model = service.default_model  # avoid the "explicit active model" early-return
    service.available_models.pop("platform_reasoning", None)

    resolved = service.get_model_for_tier("reasoning")
    assert resolved in ("openrouter_deepseek_pro", "openrouter_glm_pro")


def test_glm_flash_is_a_vision_fallback_candidate(monkeypatch):
    """The vision-aware fallback fix (get_fallback_model_id requires_vision)
    must see the new GLM-5.3-Flash entry as a valid vision-capable
    candidate, since it self-declares supports_vision=True. Asserts the
    invariant (result is vision-capable, and specifically reachable), not
    an exact winner -- which other models the ambient environment also has
    real credentials for is out of this test's control, and any of them
    winning over openrouter_glm_flash is fine as long as it's ALSO vision-
    capable (the whole point of requires_vision filtering)."""
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-key")

    service = LiteLLMService()
    # Isolate fully: only the curated OpenRouter models plus the one
    # "current" model being failed-over from should be visible here.
    service.available_models = {
        k: v for k, v in service.available_models.items()
        if k in ("openrouter_deepseek_flash", "openrouter_deepseek_pro", "openrouter_glm_flash", "openrouter_glm_pro")
    }
    result = service.get_fallback_model_id("openrouter_deepseek_flash", requires_vision=True)
    assert result == "openrouter_glm_flash"


def test_primary_model_provider_openrouter_works_via_generic_slot(monkeypatch):
    """PRIMARY_MODEL_PROVIDER=openrouter (the single-slot override, separate
    from the curated list above) must resolve through litellm's native
    "openrouter/" prefix, not the generic openai-gateway prefix trick."""
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("PRIMARY_MODEL_PROVIDER", "openrouter")
    monkeypatch.setenv("PRIMARY_MODEL_DEPLOYMENT_NAME", "z-ai/glm-5.3-flash")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-key")

    service = LiteLLMService()
    assert "primary_override" in service.available_models
    assert service.available_models["primary_override"]["model"] == "openrouter/z-ai/glm-5.3-flash"
