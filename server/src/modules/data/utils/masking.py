"""Redact sensitive connection fields before API responses."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Set

# Placeholder returned to clients; updates with this value keep the stored secret.
MASKED_PLACEHOLDER = "••••••••••••"

SENSITIVE_KEYS: Set[str] = {
    "password",
    "pass",
    "api_key",
    "token",
    "bearer_token",
    "secret",
    "secret_key",
    "secret_access_key",
    "access_key_id",
    "connection_string",
    "credentials",
}


def is_redacted_value(value: Any) -> bool:
    """True when a client sent a masked placeholder instead of a new secret."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    s = value.strip()
    if not s:
        return True
    if s == MASKED_PLACEHOLDER or s.startswith("••••"):
        return True
    # Legacy mask_connection_info shape (abc...xyz)
    if len(s) > 6 and "..." in s and not s.startswith("http"):
        return True
    return False


def _parse_config(config: Any) -> Dict[str, Any]:
    if isinstance(config, dict):
        return dict(config)
    if isinstance(config, str) and config.strip():
        try:
            parsed = json.loads(config)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def mask_connection_info(conn: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy with sensitive fields replaced by MASKED_PLACEHOLDER."""
    if not isinstance(conn, dict):
        return conn
    out = {k: v for k, v in conn.items() if not str(k).startswith("__enc_")}
    for k in list(out.keys()):
        if k in SENSITIVE_KEYS and out.get(k) not in (None, ""):
            out[k] = MASKED_PLACEHOLDER
    return out


def public_connection_config(config: Any) -> Dict[str, Any]:
    """Safe connection_config for HTTP responses — never returns full secrets."""
    return mask_connection_info(_parse_config(config))


def merge_incoming_connection_config(
    existing: Dict[str, Any],
    incoming: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Merge update payload; masked/empty sensitive fields keep stored values."""
    merged = dict(existing or {})
    for k, v in (incoming or {}).items():
        if k in SENSITIVE_KEYS and is_redacted_value(v):
            if k in existing:
                merged[k] = existing.get(k)
            continue
        merged[k] = v
    return merged
