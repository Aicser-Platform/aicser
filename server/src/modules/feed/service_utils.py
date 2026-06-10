"""Feed service utilities."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from src.modules.feed.schemas import ReactionType


def _sanitize_preview_data(values: Any, limit: int = 12) -> List[float]:
    """Normalize sparkline preview values — chart metrics are often fractional."""
    if not isinstance(values, (list, tuple)):
        return []

    out: List[float] = []
    for item in values[:limit]:
        try:
            if item is None:
                continue
            if isinstance(item, (int, float)):
                num = float(item)
            elif isinstance(item, dict) and "value" in item:
                num = float(item["value"])
            else:
                num = float(item)
            if num == num:  # skip NaN
                out.append(num)
        except (TypeError, ValueError):
            continue
    return out


def _normalize_asset_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Ensure feed asset preview numerics validate and serialize consistently."""
    if not payload:
        return {}

    result = dict(payload)
    if "previewData" in result:
        result["previewData"] = _sanitize_preview_data(result.get("previewData"))

    previews = result.get("previews")
    if isinstance(previews, list):
        normalized: List[Dict[str, Any]] = []
        for preview in previews:
            if not isinstance(preview, dict):
                continue
            entry = dict(preview)
            if "data" in entry:
                entry["data"] = _sanitize_preview_data(entry.get("data"))
            normalized.append(entry)
        result["previews"] = normalized

    dashboard_id = result.get("dashboardId")
    if dashboard_id is not None:
        result["dashboardId"] = str(dashboard_id)

    return result


def _sanitize_preview_metadata(meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize preview_metadata stored on feed posts (sparkline numerics, etc.)."""
    if not meta:
        return {}

    cleaned = dict(meta)
    if "previewData" in cleaned:
        cleaned["previewData"] = _sanitize_preview_data(cleaned.get("previewData"))

    previews = cleaned.get("previews")
    if isinstance(previews, list):
        normalized: List[Dict[str, Any]] = []
        for preview in previews:
            if not isinstance(preview, dict):
                continue
            entry = dict(preview)
            if "data" in entry:
                entry["data"] = _sanitize_preview_data(entry.get("data"))
            normalized.append(entry)
        cleaned["previews"] = normalized

    return cleaned


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _enum_value(value: Any) -> str:
    if value is None:
        return ""
    return str(getattr(value, "value", value))


def _safe_uuid(value: Any) -> Optional[UUID]:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _to_iso(value: Optional[datetime]) -> str:
    if value is None:
        return _utcnow().isoformat()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).isoformat()
    return value.isoformat()


def _time_ago(value: Optional[datetime]) -> str:
    if not value:
        return "just now"

    when = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    diff = max(0, int((_utcnow() - when).total_seconds()))

    minutes = diff // 60
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes}m ago"

    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"

    days = hours // 24
    if days < 30:
        return f"{days}d ago"

    months = days // 30
    if months < 12:
        return f"{months}mo ago"

    years = months // 12
    return f"{years}y ago"


def _reaction_values() -> List[str]:
    return [
        ReactionType.like.value,
        ReactionType.love.value,
        ReactionType.insightful.value,
        ReactionType.applause.value,
        ReactionType.funny.value,
        ReactionType.celebrate.value,
    ]
