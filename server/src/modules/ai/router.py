"""Community Edition AI metadata routes.

CE does not ship Aicser-managed AI orchestration. These endpoints expose model
availability for bring-your-own-key providers configured in Settings or env.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request

from src.modules.authentication.deps.auth_bearer import get_current_user
from src.modules.data.utils.credentials import decrypt_credentials
from src.modules.user.user_setting_repository import UserSettingRepository

router = APIRouter()
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

ENV_KEYS = {
    "openai": ("OPENAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "azure_openai": ("AZURE_OPENAI_API_KEY",),
    "ollama": ("OLLAMA_BASE_URL", "OLLAMA_HOST", "AISER_PRIVATE_MODELS"),
}


async def _optional_user_id(request: Request) -> Optional[str]:
    try:
        payload = await get_current_user(request)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    user_id = payload.get("id") or payload.get("user_id") or payload.get("sub")
    return str(user_id) if user_id else None


async def _saved_provider_keys(user_id: Optional[str]) -> dict[str, dict[str, Any]]:
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


def _has_env_provider(provider: str) -> bool:
    return any(os.getenv(env_name) for env_name in ENV_KEYS.get(provider, ()))


def _model_with_status(
    provider: str,
    model: dict[str, Any],
    *,
    available: bool,
    source: str,
) -> dict[str, Any]:
    configured_by = source if available else None
    description = (
        f"Configured via {configured_by}."
        if configured_by
        else "Configure a provider API key in Settings -> API Keys to enable this model."
    )
    return {
        **model,
        "provider": provider,
        "available": available,
        "configured_by": configured_by,
        "description": description,
        "category": model.get("category") or ("Local" if model.get("is_local") else "Standard"),
    }


@router.get("/models")
async def list_models(request: Request):
    user_id = await _optional_user_id(request)
    saved_keys = await _saved_provider_keys(user_id)
    models: list[dict[str, Any]] = []

    for provider, provider_models in PROVIDER_MODELS.items():
        saved_config = saved_keys.get(provider) or {}
        has_saved_key = bool(saved_config.get("api_key")) or provider == "ollama" and bool(saved_config.get("endpoint"))
        has_env_key = _has_env_provider(provider)
        available = has_saved_key or has_env_key
        source = "user_key" if has_saved_key else "environment" if has_env_key else ""

        for model in provider_models:
            models.append(_model_with_status(provider, model, available=available, source=source))

        custom_model = (saved_config.get("model") or "").strip()
        if custom_model and all(m.get("id") != custom_model for m in provider_models):
            models.append(
                _model_with_status(
                    provider,
                    {
                        "id": custom_model,
                        "name": custom_model,
                        "tier": "custom",
                        "cost_per_1k_tokens": 0,
                        "is_local": provider == "ollama",
                    },
                    available=available,
                    source=source,
                )
            )

    default_model = os.getenv("DEFAULT_AI_MODEL") or "auto"
    return {
        "success": True,
        "edition": "community",
        "managed_ai": False,
        "requires_provider_key": True,
        "default_model": default_model,
        "models": models,
    }


@router.get("/model-status")
async def model_status(model_id: str, request: Request):
    user_id = await _optional_user_id(request)
    saved_keys = await _saved_provider_keys(user_id)
    provider = model_id.split("/", 1)[0] if "/" in model_id else ""
    if provider == "azure":
        provider = "azure_openai"
    if provider not in PROVIDER_MODELS:
        provider = next(
            (
                candidate
                for candidate, provider_models in PROVIDER_MODELS.items()
                if any(item.get("id") == model_id for item in provider_models)
            ),
            "openai",
        )
    available = bool(saved_keys.get(provider, {}).get("api_key")) or _has_env_provider(provider)
    return {
        "success": True,
        "available": available,
        "managed_ai": False,
        "message": (
            "Model can use the configured provider key."
            if available
            else "Configure a provider API key in Settings -> API Keys."
        ),
    }
