"""CRUD for dashboard pages (multi-tab dashboards)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.dashboards.models import Dashboard, DashboardPage


class DashboardPagesService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_pages(self, dashboard_id: UUID) -> List[DashboardPage]:
        stmt = (
            select(DashboardPage)
            .where(DashboardPage.dashboard_id == dashboard_id)
            .order_by(DashboardPage.page_order.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def create_page(
        self,
        dashboard_id: UUID,
        name: str,
        description: Optional[str] = None,
        page_order: Optional[int] = None,
    ) -> DashboardPage:
        existing = await self.list_pages(dashboard_id)
        order = page_order if page_order is not None else len(existing)
        page = DashboardPage(
            dashboard_id=dashboard_id,
            name=name or f"Page {order + 1}",
            description=description,
            page_order=order,
            layout_config={},
            filters=[],
        )
        self.db.add(page)
        await self.db.commit()
        await self.db.refresh(page)

        if len(existing) == 0:
            dash = await self.db.get(Dashboard, dashboard_id)
            if dash:
                config = dict(dash.config or {})
                config["default_page_id"] = str(page.id)
                dash.config = config
                await self.db.commit()

        return page

    async def update_page(self, page_id: UUID, data: Dict[str, Any]) -> Optional[DashboardPage]:
        page = await self.db.get(DashboardPage, page_id)
        if not page:
            return None
        for key in ("name", "description", "page_order", "layout_config", "filters"):
            if key in data and data[key] is not None:
                setattr(page, key, data[key])
        await self.db.commit()
        await self.db.refresh(page)
        return page

    async def delete_page(self, page_id: UUID) -> bool:
        page = await self.db.get(DashboardPage, page_id)
        if not page:
            return False
        await self.db.delete(page)
        await self.db.commit()
        return True

    async def reorder_pages(self, dashboard_id: UUID, page_ids: List[str]) -> List[DashboardPage]:
        pages = await self.list_pages(dashboard_id)
        page_map = {str(p.id): p for p in pages}
        for idx, pid in enumerate(page_ids):
            if pid in page_map:
                page_map[pid].page_order = idx
        await self.db.commit()
        return await self.list_pages(dashboard_id)
