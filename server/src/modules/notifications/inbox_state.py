"""
Persist Activity inbox UX in user_settings (same store as other preferences).

- activity_inbox_last_viewed_at: ISO8601 — clears time-based unread for invites, alerts, AI rows.
- activity_inbox_dismissed_tips: JSON array of tip keys the user dismissed (setup / adoption nudges).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from src.modules.user.user_setting_repository import UserSettingRepository

logger = logging.getLogger(__name__)

KEY_LAST_VIEWED = "activity_inbox_last_viewed_at"
KEY_DISMISSED_TIPS = "activity_inbox_dismissed_tips"

_repo = UserSettingRepository()


def parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def ts_sort_value(iso: Optional[str]) -> float:
    dt = parse_iso_dt(iso)
    if dt is None:
        return 0.0
    return dt.timestamp()


async def get_last_viewed_at(user_id: str) -> Optional[datetime]:
    row = await _repo.get_setting(user_id, KEY_LAST_VIEWED)
    if not row or not row.value:
        return None
    return parse_iso_dt(row.value)


async def set_last_viewed_now(user_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await _repo.set_setting(user_id, KEY_LAST_VIEWED, now)


async def get_dismissed_tip_keys(user_id: str) -> set[str]:
    row = await _repo.get_setting(user_id, KEY_DISMISSED_TIPS)
    if not row or not row.value:
        return set()
    try:
        data = json.loads(row.value)
        if isinstance(data, list):
            return {str(x) for x in data if x}
    except Exception as e:
        logger.debug("dismissed tips parse failed: %s", e)
    return set()


async def add_dismissed_tip_key(user_id: str, key: str) -> None:
    k = (key or "").strip()
    if not k:
        return
    current = await get_dismissed_tip_keys(user_id)
    current.add(k)
    # Cap list size
    trimmed = sorted(current)[-80:]
    await _repo.set_setting(user_id, KEY_DISMISSED_TIPS, json.dumps(trimmed))


def notification_priority(item: Any) -> int:
    """Lower = show first (more urgent)."""
    kind = getattr(item, "kind", "")
    sev = getattr(item, "severity", "")
    if kind == "alert" and sev == "critical":
        return 0
    if kind == "ai" and sev == "critical":
        return 1
    if kind in ("alert", "ai"):
        return 2
    if kind == "invitation":
        return 3
    if kind == "activity":
        return 4
    return 5


def compute_unread_count(
    items: list,
    last_viewed: Optional[datetime],
    dismissed_tips: set[str],
) -> int:
    """Badge count aligned with last-opened time + dismissed adoption tips."""
    n = 0
    for i in items:
        if i.kind == "activity":
            dk = i.dismiss_key or ""
            if dk and dk not in dismissed_tips:
                n += 1
            continue

        ts = parse_iso_dt(i.created_at)
        if last_viewed is None:
            n += 1
            continue
        if ts is None:
            n += 1
            continue
        if ts > last_viewed:
            n += 1
    return n
