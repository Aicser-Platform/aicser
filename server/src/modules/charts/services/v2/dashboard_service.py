from typing import Optional, List, Mapping, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.modules.dashboards.models import Dashboard


class DashboardService:
    """
    Handles dashboard persistence and business logic.
    Keeps database access isolated from API / routing layer.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Mapping[str, Any]) -> Dashboard:
        if "project_id" not in data or not data["project_id"]:
            raise ValueError("project_id is required to create a dashboard.")

        dashboard = Dashboard(**data)
        self.db.add(dashboard)
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard

    async def get_by_id(
        self,
        dashboard_id: UUID,
    ) -> Optional[Dashboard]:
        stmt = (
            select(Dashboard)
            .where( Dashboard.id == dashboard_id)
        )

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_project(
        self,
        project_id: UUID,
    ) -> List[Dashboard]:
        stmt = (
            select(Dashboard)
            .where(Dashboard.project_id == project_id)
            .order_by(Dashboard.created_at.desc())
        )

        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def update(
        self,
        dashboard: Dashboard,
        data: Mapping[str, Any],
    ) -> Dashboard:
        for key, value in data.items():
            if value is not None:
                setattr(dashboard, key, value)

        await self.db.commit()
        await self.db.refresh(dashboard)

        return dashboard

    async def delete(self, dashboard: Dashboard) -> None:
        await self.db.delete(dashboard)
        await self.db.commit()
