"""Repository for deployment-level runtime settings."""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import select

from src.core.system_settings.models import SystemSetting
from src.db.session import async_session


class SystemSettingRepository:
    async def get_setting(self, key: str) -> Optional[SystemSetting]:
        async with async_session() as session:
            result = await session.execute(
                select(SystemSetting).where(SystemSetting.key == key).limit(1)
            )
            return result.scalars().first()

    async def set_setting(
        self,
        key: str,
        value: dict[str, Any],
        *,
        description: str | None = None,
        updated_by_user_id: str | None = None,
    ) -> SystemSetting:
        user_uuid = None
        if updated_by_user_id:
            try:
                user_uuid = uuid.UUID(str(updated_by_user_id))
            except ValueError:
                user_uuid = None

        async with async_session() as session:
            result = await session.execute(
                select(SystemSetting).where(SystemSetting.key == key).limit(1)
            )
            row = result.scalars().first()
            if row is None:
                row = SystemSetting(key=key, value=value, description=description)
                session.add(row)
            else:
                row.value = value
                if description is not None:
                    row.description = description
            row.updated_by_user_id = user_uuid
            await session.commit()
            await session.refresh(row)
            return row

