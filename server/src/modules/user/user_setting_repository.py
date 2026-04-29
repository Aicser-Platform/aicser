from typing import Optional, Dict
from sqlalchemy import select

from src.shared.repository import BaseRepository
from src.modules.user.models_user_setting import UserSetting
from src.db.session import async_session


class UserSettingRepository:
    def __init__(self):
        self.model = UserSetting

    async def get_setting(self, user_id: str, key: str) -> Optional[UserSetting]:
        async with async_session() as session:
            query = select(self.model).where(self.model.user_id == user_id).where(self.model.key == key)
            result = await session.execute(query)
            return result.scalars().first()

    async def set_setting(self, user_id: str, key: str, value: str) -> UserSetting:
        async with async_session() as session:
            # Try update existing
            query = select(self.model).where(self.model.user_id == user_id).where(self.model.key == key)
            result = await session.execute(query)
            existing = result.scalars().first()
            
            if existing:
                existing.value = value
                await session.commit()
                await session.refresh(existing)
                return existing

            # Create new
            obj = self.model(user_id=user_id, key=key, value=value)
            session.add(obj)
            await session.commit()
            await session.refresh(obj)
            return obj

    async def get_all_settings(self, user_id: str) -> Dict[str, str]:
        """Return all settings for a user as key -> value (value as string)."""
        async with async_session() as session:
            query = select(self.model).where(self.model.user_id == user_id)
            result = await session.execute(query)
            rows = result.scalars().all()
            return {r.key: (r.value or "") for r in rows} if rows else {}
