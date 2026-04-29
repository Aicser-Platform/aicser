"""Feed service utilities."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import UUID

from src.modules.feed.schemas import ReactionType


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
