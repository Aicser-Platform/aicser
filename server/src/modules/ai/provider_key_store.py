"""Normalize BYOK provider-key blobs (single model + multi-model list).

Stored shape (Fernet-encrypted JSON in user_settings / org settings)::

    {
      "api_key": "...",          # optional for ollama
      "endpoint": "...",         # azure / ollama
      "model": "default-id",     # preferred / first model (legacy)
      "models": ["id1", "id2"]   # enabled models for the chat picker
    }

Legacy rows with only ``model`` keep working: ``models`` is derived as ``[model]``.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def slugify_model_id(model_id: str) -> str:
    """Stable short slug for BYOK internal ids (byok_ollama__qwen3_8_27b)."""
    raw = (model_id or "").strip().lower()
    raw = raw.removeprefix("ollama/").removeprefix("openrouter/").removeprefix("azure/")
    slug = re.sub(r"[^a-z0-9]+", "_", raw).strip("_")
    return slug[:48] if slug else "model"


def enabled_models_from_store(data: Optional[Dict[str, Any]]) -> List[str]:
    """Return deduped enabled model ids from a decrypted provider store dict."""
    if not isinstance(data, dict):
        return []
    out: List[str] = []
    seen: set[str] = set()
    models = data.get("models")
    if isinstance(models, list):
        for item in models:
            mid = str(item or "").strip()
            if mid and mid not in seen:
                seen.add(mid)
                out.append(mid)
    legacy = str(data.get("model") or "").strip()
    if legacy and legacy not in seen:
        out.insert(0, legacy)
    return out


def normalize_store_for_save(
    *,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
    models: Optional[List[str]] = None,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Merge payload + existing into a canonical store dict (pre-encrypt)."""
    prev = dict(existing or {})
    store: Dict[str, Any] = {}

    if api_key:
        store["api_key"] = api_key
    elif prev.get("api_key"):
        store["api_key"] = prev["api_key"]

    ep = (endpoint or "").strip() or str(prev.get("endpoint") or "").strip()
    if ep:
        store["endpoint"] = ep

    enabled: List[str] = []
    seen: set[str] = set()
    if isinstance(models, list):
        for item in models:
            mid = str(item or "").strip()
            if mid and mid not in seen:
                seen.add(mid)
                enabled.append(mid)
    elif models is None:
        # Preserve existing models when the client only updates the key/endpoint.
        for mid in enabled_models_from_store(prev):
            if mid not in seen:
                seen.add(mid)
                enabled.append(mid)

    preferred = (model or "").strip()
    if preferred and preferred not in seen:
        enabled.insert(0, preferred)
        seen.add(preferred)
    elif preferred and preferred in seen:
        enabled = [preferred] + [m for m in enabled if m != preferred]

    if enabled:
        store["models"] = enabled
        store["model"] = preferred if preferred in seen else enabled[0]
    elif preferred:
        store["model"] = preferred
        store["models"] = [preferred]

    return store


def byok_internal_id(provider: str, model_id: str, *, default_id: str, is_default: bool) -> str:
    """Legacy default keeps ``byok_{provider}``; extras get ``byok_{provider}__{slug}``."""
    if is_default:
        return default_id
    slug = slugify_model_id(model_id)
    return f"{default_id}__{slug}" if slug else default_id
