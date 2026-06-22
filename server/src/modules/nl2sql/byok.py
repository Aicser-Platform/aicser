"""BYOK model registration for CE NL2SQL (mirrors EE user_byok_models without EE imports)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional, Tuple

from src.modules.user.user_setting_repository import UserSettingRepository

logger = logging.getLogger(__name__)

PROVIDER_SETTING_KEYS = ("google", "openai", "anthropic", "azure_openai")

BYOK_INTERNAL_ID: Dict[str, str] = {
    "google": "byok_google",
    "openai": "byok_openai",
    "anthropic": "byok_anthropic",
    "azure_openai": "byok_azure_openai",
}


def _parse_store(raw_val: Optional[str]) -> Optional[Dict[str, str]]:
    if not raw_val:
        return None
    try:
        data = json.loads(raw_val)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    from src.modules.data.utils.credentials import decrypt_credentials

    data = decrypt_credentials(data)
    api_key = (data.get("api_key") or "").strip()
    if not api_key:
        return None
    return {
        "api_key": api_key,
        "model": (data.get("model") or "").strip(),
        "endpoint": (data.get("endpoint") or "").strip(),
    }


def build_byok_model_entry(provider: str, row: Dict[str, str]) -> Optional[Tuple[str, Dict[str, Any]]]:
    internal_id = BYOK_INTERNAL_ID.get(provider)
    if not internal_id:
        return None

    api_key = row["api_key"]
    model = row["model"]
    endpoint = row["endpoint"]

    if provider == "google":
        if not model:
            model = "gemini-2.5-flash"
        litellm_model = model if model.startswith("gemini/") else f"gemini/{model}"
        short = model.split("/")[-1] if "/" in model else model
        return internal_id, {
            "id": internal_id,
            "name": f"Gemini ({short}) — your key",
            "model": litellm_model,
            "api_key": api_key,
            "provider": "google",
            "tier": "fast",
            "max_tokens": 8192,
            "temperature": 0.1,
            "cost_per_1k_tokens": 0.0,
            "description": "Uses your Google (Gemini) API key from Settings.",
            "byok_provider": provider,
            "available": True,
        }

    if provider == "openai":
        if not model:
            model = "gpt-4o-mini"
        return internal_id, {
            "id": internal_id,
            "name": f"{model} (OpenAI) — your key",
            "model": model,
            "api_key": api_key,
            "provider": "openai",
            "tier": "fast",
            "max_tokens": 8000,
            "temperature": 0.1,
            "cost_per_1k_tokens": 0.0,
            "description": "Uses your OpenAI API key from Settings.",
            "byok_provider": provider,
            "available": True,
        }

    if provider == "anthropic":
        if not model:
            model = "claude-3-5-sonnet-20240620"
        litellm_model = model if model.startswith("anthropic/") else f"anthropic/{model.lstrip('/')}"
        short = litellm_model.split("/")[-1]
        return internal_id, {
            "id": internal_id,
            "name": f"{short} (Anthropic) — your key",
            "model": litellm_model,
            "api_key": api_key,
            "provider": "anthropic",
            "tier": "fast",
            "max_tokens": 8000,
            "temperature": 0.1,
            "cost_per_1k_tokens": 0.0,
            "description": "Uses your Anthropic API key from Settings.",
            "byok_provider": provider,
            "available": True,
        }

    if provider == "azure_openai":
        if not model or not endpoint:
            return None
        try:
            from src.core.config import settings

            api_version = getattr(settings, "AZURE_OPENAI_API_VERSION", None) or os.getenv(
                "AZURE_OPENAI_API_VERSION", "2025-01-01-preview"
            )
        except Exception:
            api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
        base = endpoint.rstrip("/") + "/"
        dep = model.replace("azure/", "").strip()
        return internal_id, {
            "id": internal_id,
            "name": f"Azure OpenAI ({dep}) — your key",
            "model": f"azure/{dep}",
            "api_key": api_key,
            "api_base": base,
            "api_version": api_version,
            "provider": "azure",
            "tier": "fast",
            "max_tokens": 16384,
            "temperature": 0.1,
            "cost_per_1k_tokens": 0.0,
            "description": "Uses your Azure OpenAI resource from Settings.",
            "byok_provider": provider,
            "available": True,
        }

    return None


async def load_user_byok_models(user_id: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """Return BYOK model configs keyed by internal id."""
    if not user_id:
        return {}
    repo = UserSettingRepository()
    out: Dict[str, Dict[str, Any]] = {}
    for provider in PROVIDER_SETTING_KEYS:
        raw = await repo.get_setting(str(user_id), f"provider_key.{provider}")
        if not raw or not getattr(raw, "value", None):
            continue
        row = _parse_store(raw.value)
        if not row:
            continue
        built = build_byok_model_entry(provider, row)
        if built:
            iid, cfg = built
            out[iid] = cfg
    return out
