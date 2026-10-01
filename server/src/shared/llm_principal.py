"""Who an AI call is made for, for the life of one request.

A user's own provider keys (BYOK) only take effect when the LLM service loads them for that
user. The service is created in many places; rather than each one remembering to load keys, the
request records its user (and verified organization) here once and the service loads them on
first use. Context variables follow the request into tasks it spawns.
"""

from __future__ import annotations

import contextvars
from typing import Optional, Tuple

_principal: contextvars.ContextVar[Optional[Tuple[str, Optional[str]]]] = contextvars.ContextVar(
    "aicser_llm_principal", default=None
)


# Keys loaded for this request, so the many LLM service instances one request creates look them
# up once instead of once each.
_loaded_keys: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("aicser_llm_keys", default=None)


def set_llm_principal(user_id: Optional[str], organization_id: Optional[str] = None) -> None:
    if not user_id:
        return
    current = _principal.get()
    # Keep a verified organization once known; a later user-only set must not drop it.
    if current and current[0] == str(user_id) and current[1] and not organization_id:
        return
    _principal.set((str(user_id), str(organization_id) if organization_id else None))
    _loaded_keys.set({})


def request_key_cache() -> Optional[dict]:
    """Per-request store for loaded provider keys (None outside a request)."""
    return _loaded_keys.get()


def get_llm_principal() -> Optional[Tuple[str, Optional[str]]]:
    return _principal.get()
