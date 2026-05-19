from dataclasses import dataclass
from typing import Optional, Dict
from sqlalchemy import select

from src.modules.user.models import User
from src.db.session import async_session


@dataclass
class _SettingEntry:
    """Lightweight stand-in for UserSetting rows; keeps caller API identical."""
    key: str
    value: Optional[str]


class UserSettingRepository:
    """Stores per-user key/value settings inside the ``users.settings`` JSONB column."""

    async def get_setting(self, user_id: str, key: str) -> Optional[_SettingEntry]:
        async with async_session() as session:
            row = await self._get_user(session, user_id)
            if row is None:
                return None
            blob: dict = row.settings or {}
            if key not in blob:
                return None
            return _SettingEntry(key=key, value=blob.get(key))

    async def set_setting(self, user_id: str, key: str, value: str) -> _SettingEntry:
        async with async_session() as session:
            row = await self._get_user(session, user_id)
            if row is None:
                raise ValueError(f"User {user_id} not found")
            blob: dict = dict(row.settings or {})
            blob[key] = value
            row.settings = blob
            await session.commit()
            return _SettingEntry(key=key, value=value)

    async def get_all_settings(self, user_id: str) -> Dict[str, str]:
        async with async_session() as session:
            row = await self._get_user(session, user_id)
            if row is None:
                return {}
            blob: dict = row.settings or {}
            return {k: (v or "") for k, v in blob.items() if isinstance(v, str)}

    # ── helpers ──────────────────────────────────────────────────────────────

    async def _get_user(self, session, user_id: str):
        """Return the User row by id or user_id (UUID string)."""
        import uuid as _uuid
        try:
            uid = _uuid.UUID(str(user_id))
        except ValueError:
            return None
        result = await session.execute(
            select(User).where(
                (User.id == uid) | (User.user_id == uid)
            ).limit(1)
        )
        return result.scalars().first()
