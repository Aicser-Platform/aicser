"""
User notification preferences (user_settings.notification_preferences JSON).

Used by Settings → Notifications, Activity inbox filtering, and General → notifications sync.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from pydantic import BaseModel

from src.modules.user.user_setting_repository import UserSettingRepository

logger = logging.getLogger(__name__)

NOTIFICATION_PREFS_KEY = "notification_preferences"
_user_settings_repo = UserSettingRepository()


def _coerce_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).lower() in ("true", "1", "yes")


def default_notification_prefs() -> dict[str, bool]:
    """Persisted notification_preferences — end-user UI only edits email + in-app Activity."""
    return {
        "email_notifications": True,
        "push_notifications": True,
    }


_ALL_KEYS = tuple(default_notification_prefs().keys())


async def load_notification_prefs_raw(user_id: str) -> dict[str, bool]:
    out = default_notification_prefs()
    raw = await _user_settings_repo.get_setting(user_id, NOTIFICATION_PREFS_KEY)
    if raw and raw.value:
        try:
            stored = json.loads(raw.value)
            if isinstance(stored, dict):
                for k in _ALL_KEYS:
                    if k in stored:
                        out[k] = _coerce_bool(stored[k])
        except Exception:
            logger.debug("notification_preferences parse failed for user", exc_info=True)
    return out


async def load_notification_prefs_merged(user_id: str) -> dict[str, bool]:
    """Merged prefs; General tab `notifications` overrides push_notifications (Activity bell)."""
    out = await load_notification_prefs_raw(user_id)
    gen = await _user_settings_repo.get_setting(user_id, "notifications")
    if gen and gen.value is not None and str(gen.value).strip() != "":
        out["push_notifications"] = _coerce_bool(gen.value)
    return out


async def save_notification_prefs(user_id: str, prefs: dict[str, Any]) -> None:
    clean = default_notification_prefs()
    for k in clean:
        if k in prefs:
            clean[k] = bool(prefs[k])
    await _user_settings_repo.set_setting(user_id, NOTIFICATION_PREFS_KEY, json.dumps(clean))


class NotificationPreferencesPayload(BaseModel):
    """Settings → Notifications tab (essentials only)."""

    email_notifications: Optional[bool] = None
    push_notifications: Optional[bool] = None
