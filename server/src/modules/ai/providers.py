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
    "openai": [
        {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "gpt-4o", "name": "GPT-4o", "tier": "standard", "cost_per_1k_tokens": 0},
    ],
    "anthropic": [
        {"id": "claude-3-5-haiku-latest", "name": "Claude 3.5 Haiku", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "claude-3-5-sonnet-latest", "name": "Claude 3.5 Sonnet", "tier": "standard", "cost_per_1k_tokens": 0},
    ],
    "google": [
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "tier": "standard", "cost_per_1k_tokens": 0},
    ],
    "azure_openai": [
        {"id": "azure/gpt-4o-mini", "name": "Azure GPT-4o Mini", "tier": "fast", "cost_per_1k_tokens": 0},
        {"id": "azure/gpt-4o", "name": "Azure GPT-4o", "tier": "standard", "cost_per_1k_tokens": 0},
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
    "ollama": ("OLLAMA_BASE_URL", "OLLAMA_HOST", "AISER_PRIVATE_MODELS"),
}


def has_env_provider(provider: str) -> bool:
    return any(os.getenv(env_name) for env_name in ENV_KEYS.get(provider, ()))


def provider_for_model(model_id: str) -> str:
    """Best-effort provider resolution for a model id."""
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
    # gpt-*, o1/o3-*, and anything unrecognized default to openai
    return "openai"


def litellm_model_string(provider: str, model_id: str) -> str:
    """Format a model id for litellm's provider-prefixed routing."""
    if "/" in model_id:
        return model_id  # azure/…, ollama/…, gemini/… already routed
    if provider == "anthropic":
        return f"anthropic/{model_id}"
    if provider == "google":
        return f"gemini/{model_id}"
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
