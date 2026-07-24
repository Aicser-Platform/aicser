"""Shared CE AI provider catalog + BYOK key helpers.

Extracted so both the CE AI router and the text-to-SQL service can use them
without importing each other. CE ships no managed AI; keys are bring-your-own.
"""

from __future__ import annotations

import json
import os
from typing import Any

from src.modules.data.utils.credentials import decrypt_credentials
from src.modules.user.user_setting_repository import UserSettingRepository

_settings_repo = UserSettingRepository()

PROVIDER_MODELS: dict[str, list[dict[str, Any]]] = {
    # GPT-5.6 (Sol/Terra/Luna tiers) is the current flagship generation as of Jul
    # 2026; gpt-4.1-mini is kept as a bridge option (still callable, retires Oct 23
    # 2026) but gpt-4o/gpt-4o-mini were dropped — fully superseded, no firm date
    # but no upside over gpt-4.1-mini either. Use the custom-model field for any
    # of these that a user still specifically needs.
    "openai": [
        {"id": "gpt-5.6-luna", "name": "GPT-5.6 Luna", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "gpt-5.6-terra", "name": "GPT-5.6 Terra", "tier": "standard", "cost_per_1k_tokens": 0},
        {"id": "gpt-5.6-sol", "name": "GPT-5.6 Sol", "tier": "reasoning", "cost_per_1k_tokens": 0},
        {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini (retiring Oct 2026)", "tier": "fast", "cost_per_1k_tokens": 0},
    ],
    "anthropic": [
        {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "claude-sonnet-5", "name": "Claude Sonnet 5", "tier": "standard", "cost_per_1k_tokens": 0},
        {"id": "claude-opus-4-8", "name": "Claude Opus 4.8", "tier": "reasoning", "cost_per_1k_tokens": 0},
    ],
    # gemini-2.0-flash was shut down 2026-06-01 and gemini-1.5-pro is fully retired —
    # both replaced outright rather than kept as broken options. gemini-2.5-* is
    # still nominally alive (shutdown Oct 16 2026) but has been intermittently
    # 404ing since Jul 9 2026, so the 3.x family is the safe default now.
    "google": [
        {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash", "tier": "standard", "cost_per_1k_tokens": 0},
        {"id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro (preview)", "tier": "reasoning", "cost_per_1k_tokens": 0},
    ],
    "azure_openai": [
        {"id": "azure/gpt-5.6-luna", "name": "Azure GPT-5.6 Luna", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "azure/gpt-5.6-terra", "name": "Azure GPT-5.6 Terra", "tier": "standard", "cost_per_1k_tokens": 0},
        {"id": "azure/gpt-5.6-sol", "name": "Azure GPT-5.6 Sol", "tier": "reasoning", "cost_per_1k_tokens": 0},
        {"id": "azure/gpt-4.1-mini", "name": "Azure GPT-4.1 Mini (retiring Oct 2026)", "tier": "fast", "cost_per_1k_tokens": 0},
    ],
    # DeepSeek's legacy "deepseek-chat"/"deepseek-reasoner" aliases were retired by
    # DeepSeek on 2026-07-24 in favor of explicit V4 model ids — use those directly.
    "deepseek": [
        {"id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "tier": "standard", "cost_per_1k_tokens": 0},
    ],
    # OpenRouter fronts hundreds of vendor/model slugs — most aren't worth
    # pre-listing, but GLM 5.2 is called out explicitly since it's a common ask.
    # Anything else goes through the custom-model field.
    "openrouter": [
        {"id": "z-ai/glm-5.2", "name": "GLM 5.2 (via OpenRouter)", "tier": "reasoning", "cost_per_1k_tokens": 0},
    ],
    "ollama": [
        {"id": "ollama/llama3.1", "name": "Ollama Llama 3.1", "tier": "local", "cost_per_1k_tokens": 0, "is_local": True},
    ],
}

ENV_KEYS: dict[str, tuple[str, ...]] = {
    "openai": ("OPENAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "azure_openai": ("AZURE_OPENAI_API_KEY",),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "ollama": ("OLLAMA_BASE_URL", "OLLAMA_HOST", "AISER_PRIVATE_MODELS"),
}


def has_env_provider(provider: str) -> bool:
    return any(os.getenv(env_name) for env_name in ENV_KEYS.get(provider, ()))


def provider_for_model(model_id: str, keys: dict[str, dict[str, Any]] | None = None) -> str:
    """Best-effort provider resolution for a model id.

    OpenRouter model ids are arbitrary "vendor/model" slugs (e.g. "z-ai/glm-4.6")
    that can't be told apart from a native provider name by string shape alone —
    so when the caller has the user's saved BYOK configs handy, check those first:
    if some provider's saved `model` matches exactly, that's authoritative.
    """
    if keys:
        for provider, cfg in keys.items():
            if (cfg.get("model") or "").strip() == model_id:
                return provider

    if "/" in model_id:
        prefix = model_id.split("/", 1)[0]
        if prefix == "azure":
            return "azure_openai"
        if prefix == "gemini":
            return "google"
        if prefix in PROVIDER_MODELS:
            return prefix
    for provider, models in PROVIDER_MODELS.items():
        if any(m.get("id") == model_id for m in models):
            return provider
    low = model_id.lower()
    if low.startswith("claude"):
        return "anthropic"
    if low.startswith("gemini"):
        return "google"
    if low.startswith("deepseek"):
        return "deepseek"
    # gpt-*, o1/o3-*, and anything unrecognized default to openai
    return "openai"


def litellm_model_string(provider: str, model_id: str) -> str:
    """Format a model id for litellm's provider-prefixed routing."""
    if provider == "openrouter":
        return model_id if model_id.startswith("openrouter/") else f"openrouter/{model_id}"
    if "/" in model_id:
        return model_id  # azure/…, ollama/…, gemini/… already routed
    if provider == "anthropic":
        return f"anthropic/{model_id}"
    if provider == "google":
        return f"gemini/{model_id}"
    if provider == "deepseek":
        return f"deepseek/{model_id}"
    return model_id  # openai bare ids


async def saved_provider_keys(user_id: str | None) -> dict[str, dict[str, Any]]:
    """Return decrypted BYOK provider configs keyed by provider name."""
    if not user_id:
        return {}
    all_settings = await _settings_repo.get_all_settings(user_id)
    providers: dict[str, dict[str, Any]] = {}
    for key, raw_value in all_settings.items():
        if not key.startswith("provider_key."):
            continue
        provider = key.split(".", 2)[1]
        try:
            data = json.loads(raw_value)
            if isinstance(data, dict):
                providers[provider] = decrypt_credentials(data)
        except Exception:
            continue
    return providers
