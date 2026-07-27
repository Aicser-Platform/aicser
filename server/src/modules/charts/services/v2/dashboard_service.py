from typing import Optional, List, Mapping, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from src.modules.dashboards.models import Dashboard


class DashboardService:
    """
    Handles dashboard persistence and business logic.
    Keeps database access isolated from API / routing layer.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _normalize_data(data: Mapping[str, Any], *, default_name: bool = False) -> dict[str, Any]:
        normalized = dict(data)
        title = normalized.pop("title", None)
        if title is not None and normalized.get("name") is None:
            normalized["name"] = title
        if default_name and not normalized.get("name"):
            normalized["name"] = "Untitled Dashboard"
        return normalized

    async def create(self, data: Mapping[str, Any]) -> Dashboard:
        dashboard = Dashboard(**self._normalize_data(data, default_name=True))
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

    async def list_all(self) -> List[Dashboard]:
        stmt = select(Dashboard).order_by(Dashboard.created_at.desc())
        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def list_by_user(self, user_id: UUID) -> List[Dashboard]:
        """CE scoping: a user's own dashboards plus legacy rows with no
        recorded owner (created before the created_by column existed).
        Never excludes pre-existing dashboards no one can be attributed to.
        """
        stmt = (
            select(Dashboard)
            .where(or_(Dashboard.created_by == user_id, Dashboard.created_by.is_(None)))
            .order_by(Dashboard.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars())

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
        normalized = self._normalize_data(data)
        # Library fields handled by DashboardLibraryService — don't setattr unknown keys
        skip = {"collectionId", "isFavorite", "tags", "collection_id", "is_favorite"}
        for key, value in normalized.items():
            if key in skip:
                continue
            if value is not None and hasattr(dashboard, key):
                setattr(dashboard, key, value)
        if "description" in data:
            dashboard.description = data.get("description")

        await self.db.commit()
        await self.db.refresh(dashboard)

        return dashboard

    async def delete(self, dashboard: Dashboard) -> None:
        """Soft-delete dashboard into trash. Structure kept for restore."""
        from datetime import datetime, timezone

        if hasattr(dashboard, "is_deleted"):
            dashboard.is_deleted = True
            if hasattr(dashboard, "deleted_at"):
                dashboard.deleted_at = datetime.now(timezone.utc)
            await self.db.commit()
            return
        await self.purge(dashboard)

    async def restore(self, dashboard: Dashboard) -> Dashboard:
        if hasattr(dashboard, "is_deleted"):
            dashboard.is_deleted = False
        if hasattr(dashboard, "deleted_at"):
            dashboard.deleted_at = None
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard

    async def purge(self, dashboard: Dashboard) -> None:
        """Permanently remove dashboard and dependent rows.

        Chart library SSOT: placements are unlinked; chart rows are kept so other
        boards / Chart Designer still share the same definition. Charts that only
        pointed at this dashboard via charts.dashboard_id have that FK cleared.
        """
        from sqlalchemy import delete, select, update

        from src.core.edition import is_ee_enabled
        from src.modules.charts.models import Chart, DashboardEmbed, QueryPattern
        from src.modules.dashboards.models import (
            DashboardAnalytics,
            DashboardChart,
            DashboardPage,
            DashboardShare,
            DashboardVersion,
            dashboard_widgets_table,
        )

        dashboard_id = dashboard.id

        if is_ee_enabled():
            await self.db.execute(
                delete(dashboard_widgets_table).where(
                    dashboard_widgets_table.c.dashboard_id == dashboard_id
                )
            )

        # Detach placements only — never destroy shared library charts
        await self.db.execute(
            delete(DashboardChart).where(DashboardChart.dashboard_id == dashboard_id)
        )

        await self.db.execute(
            update(Chart)
            .where(Chart.dashboard_id == dashboard_id)
            .values(dashboard_id=None)
        )

        await self.db.execute(
            update(QueryPattern)
            .where(QueryPattern.dashboard_id == dashboard_id)
            .values(dashboard_id=None)
        )

        # Versions cascade via FK; delete explicitly for clarity
        try:
            await self.db.execute(
                delete(DashboardVersion).where(DashboardVersion.dashboard_id == dashboard_id)
            )
        except Exception:
            pass

        pages_result = await self.db.execute(
            select(DashboardPage).where(DashboardPage.dashboard_id == dashboard_id)
        )
        for page in pages_result.scalars():
            await self.db.delete(page)

        await self.db.execute(
            delete(DashboardShare).where(DashboardShare.dashboard_id == dashboard_id)
        )
        await self.db.execute(
            delete(DashboardAnalytics).where(DashboardAnalytics.dashboard_id == dashboard_id)
        )
        await self.db.execute(
            delete(DashboardEmbed).where(DashboardEmbed.dashboard_id == dashboard_id)
        )

        if is_ee_enabled():
            try:
                from sqlalchemy import text

                dash_id_str = str(dashboard_id)
                await self.db.execute(
                    text(
                        "DELETE FROM scheduled_emails WHERE body LIKE :meta_pattern OR body LIKE :url_pattern"
                    ),
                    {
                        "meta_pattern": f'%"dashboard_id": "{dash_id_str}"%',
                        "url_pattern": f"%{dash_id_str}%",
                    },
                )
            except Exception:
                pass

        await self.db.delete(dashboard)
        await self.db.commit()
