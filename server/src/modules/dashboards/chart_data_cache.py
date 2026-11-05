"""Short-lived Redis cache for executed dashboard chart data.

Chart execution runs the widget's SQL against the warehouse/lakehouse on every
view (Studio, feed, chat preview cards). The same viewer re-opening a
conversation or dashboard within a few minutes gets identical rows, so the
result is cached per viewer.

The key is scoped to everything that can change the rows a viewer sees:
- viewer identity + token claims (row-level security is applied per identity,
  so two viewers never share an entry)
- the chart row's ``updated_at`` (any edit invalidates)
- the effective chart_query after runtime filters / drill context
- row cap and embed narrowing

Semantic-model, RLS-policy, and source-data changes are bounded by the TTL.
``CHART_DATA_CACHE_TTL_SECONDS=0`` disables the cache.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, Optional

from src.core.config import settings
from src.modules.data.services.query_identity import QueryIdentity

logger = logging.getLogger(__name__)

_KEY_PREFIX = "chart_data:v1"
# Token-lifetime claims change on every refresh without changing access.
_VOLATILE_CLAIMS = frozenset({"exp", "iat", "nbf", "jti", "auth_time"})


def chart_data_cache_ttl() -> int:
    return max(int(getattr(settings, "CHART_DATA_CACHE_TTL_SECONDS", 0) or 0), 0)


def _identity_fingerprint(identity: Optional[QueryIdentity]) -> Dict[str, Any]:
    if identity is None:
        return {"anonymous": True}
    claims = {
        k: v
        for k, v in dict(identity.token_payload or {}).items()
        if k not in _VOLATILE_CLAIMS
    }
    return {
        "user_id": identity.user_id,
        "organization_id": identity.organization_id,
        "project_id": identity.project_id,
        "claims": claims,
    }


def build_chart_data_cache_key(
    *,
    dashboard_id: Any,
    chart: Any,
    chart_query: Any,
    identity: Optional[QueryIdentity],
    row_cap: Optional[int],
    narrow_only: bool,
) -> str:
    updated_at = getattr(chart, "updated_at", None)
    material = {
        "dashboard_id": str(dashboard_id),
        "chart_id": str(getattr(chart, "id", "")),
        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at),
        "chart_type": getattr(chart, "chart_type", None),
        "data_source_id": str(getattr(chart, "data_source_id", "") or ""),
        "chart_query": chart_query or {},
        "identity": _identity_fingerprint(identity),
        "row_cap": row_cap,
        "narrow_only": narrow_only,
    }
    digest = hashlib.sha256(
        json.dumps(material, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    return f"{_KEY_PREFIX}:{getattr(chart, 'id', '')}:{digest}"


def get_cached_chart_data(key: str) -> Optional[Dict[str, Any]]:
    from src.core.cache import cache

    if cache is None:
        return None
    try:
        value = cache.get(key)
    except Exception as exc:  # cache must never break chart reads
        logger.debug("chart data cache get failed: %s", exc)
        return None
    return value if isinstance(value, dict) else None


def set_cached_chart_data(key: str, value: Dict[str, Any], ttl: int) -> None:
    from src.core.cache import cache

    if cache is None or ttl <= 0:
        return
    try:
        cache.set(key, value, ttl=ttl)
    except Exception as exc:
        logger.debug("chart data cache set failed: %s", exc)
