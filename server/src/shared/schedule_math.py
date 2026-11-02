"""Wall-clock schedule math (timezone-aware), shared by every scheduled feature (notebooks, workbooks, agent schedules)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def next_run(
    frequency: str,
    *,
    hour: int = 7,
    minute: int = 0,
    weekday: int = 0,
    tz: str = "UTC",
    after: datetime | None = None,
) -> datetime:
    now = after or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    try:
        zone = ZoneInfo(tz)
    except Exception:
        zone = timezone.utc
    local = now.astimezone(zone)
    candidate = local.replace(second=0, microsecond=0)

    def bump(**kwargs):
        nonlocal candidate
        candidate = candidate.replace(**kwargs)

    if frequency == "hourly":
        bump(minute=minute)
        if candidate <= local:
            candidate += timedelta(hours=1)
            candidate = candidate.replace(minute=minute)
    elif frequency == "daily":
        bump(hour=hour, minute=minute)
        if candidate <= local:
            candidate += timedelta(days=1)
    elif frequency == "weekdays":
        bump(hour=hour, minute=minute)
        while candidate.weekday() >= 5 or candidate <= local:
            candidate += timedelta(days=1)
            candidate = candidate.replace(hour=hour, minute=minute)
    elif frequency == "weekly":
        bump(hour=hour, minute=minute)
        while candidate.weekday() != weekday % 7 or candidate <= local:
            candidate += timedelta(days=1)
            candidate = candidate.replace(hour=hour, minute=minute)
    else:
        bump(hour=hour, minute=minute)
        if candidate <= local:
            candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)
