"""
Chart library: paginated lists, collections, favorites, dashboard usage, link/upsert.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from src.modules.charts.models import Chart, ChartCollection
from src.modules.dashboards.models import Dashboard, DashboardChart


class ChartLibraryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _scope_filter(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
    ):
        if project_id is not None:
            return Chart.project_id == project_id
        return and_(Chart.user_id == user_id, Chart.project_id.is_(None))

    def _collection_scope(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
    ):
        if project_id is not None:
            return ChartCollection.project_id == project_id
        return and_(ChartCollection.user_id == user_id, ChartCollection.project_id.is_(None))

    async def _ensure_unique_collection_name(
        self,
        *,
        name: str,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
        exclude_id: Optional[uuid.UUID] = None,
    ) -> str:
        cleaned = (name or "").strip() or "Untitled"
        filters = [
            self._collection_scope(user_id=user_id, project_id=project_id),
            func.lower(func.trim(ChartCollection.name)) == cleaned.lower(),
        ]
        if exclude_id is not None:
            filters.append(ChartCollection.id != exclude_id)
        exists = await self.db.execute(select(ChartCollection.id).where(and_(*filters)).limit(1))
        if exists.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f'A collection named "{cleaned}" already exists',
            )
        return cleaned

    async def list_collections(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
    ) -> List[ChartCollection]:
        stmt = (
            select(ChartCollection)
            .where(self._collection_scope(user_id=user_id, project_id=project_id))
            .order_by(ChartCollection.sort_order.asc(), ChartCollection.name.asc())
        )
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    async def create_collection(
        self,
        *,
        name: str,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
        parent_id: Optional[uuid.UUID] = None,
        sort_order: int = 0,
    ) -> ChartCollection:
        cleaned = await self._ensure_unique_collection_name(
            name=name, user_id=user_id, project_id=project_id
        )
        row = ChartCollection(
            name=cleaned,
            user_id=user_id,
            project_id=project_id,
            parent_id=parent_id,
            sort_order=sort_order,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def update_collection(
        self,
        collection: ChartCollection,
        *,
        name: Optional[str] = None,
        parent_id: Optional[uuid.UUID] = None,
        sort_order: Optional[int] = None,
        clear_parent: bool = False,
    ) -> ChartCollection:
        if name is not None:
            collection.name = await self._ensure_unique_collection_name(
                name=name,
                user_id=collection.user_id,
                project_id=collection.project_id,
                exclude_id=collection.id,
            )
        if clear_parent:
            collection.parent_id = None
        elif parent_id is not None:
            collection.parent_id = parent_id
        if sort_order is not None:
            collection.sort_order = sort_order
        await self.db.commit()
        await self.db.refresh(collection)
        return collection

    async def delete_collection(self, collection: ChartCollection) -> None:
        # Industry default: delete folder → charts become unfiled (not destroyed)
        await self.db.execute(
            text("UPDATE charts SET collection_id = NULL WHERE collection_id = :cid"),
            {"cid": str(collection.id)},
        )
        await self.db.delete(collection)
        await self.db.commit()

    async def get_collection(self, collection_id: uuid.UUID) -> Optional[ChartCollection]:
        res = await self.db.execute(select(ChartCollection).where(ChartCollection.id == collection_id))
        return res.scalar_one_or_none()

    async def list_library(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
        q: Optional[str] = None,
        facet: str = "all",
        collection_id: Optional[uuid.UUID] = None,
        data_source_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        detail: str = "summary",
    ) -> Dict[str, Any]:
        limit = max(1, min(int(limit or 50), 200))
        offset = max(0, int(offset or 0))
        facet = (facet or "all").strip().lower()
        detail = (detail or "summary").strip().lower()

        usage_sq = (
            select(
                DashboardChart.chart_id.label("chart_id"),
                func.count(DashboardChart.id).label("usage_count"),
            )
            .group_by(DashboardChart.chart_id)
            .subquery()
        )

        filters = [self._scope_filter(user_id=user_id, project_id=project_id)]

        if q and q.strip():
            filters.append(Chart.title.ilike(f"%{q.strip()}%"))
        if collection_id is not None:
            filters.append(Chart.collection_id == collection_id)
        if data_source_id:
            filters.append(Chart.data_source_id == str(data_source_id))

        if hasattr(Chart, "is_deleted"):
            if facet == "trash":
                filters.append(Chart.is_deleted.is_(True))
            else:
                filters.append(or_(Chart.is_deleted.is_(False), Chart.is_deleted.is_(None)))

        if facet == "favorites":
            filters.append(Chart.is_favorite.is_(True))
        elif facet == "library":
            filters.append(usage_sq.c.usage_count.is_(None))
        elif facet in ("on_dashboards", "used"):
            filters.append(usage_sq.c.usage_count.is_not(None))
        elif facet == "recent":
            filters.append(Chart.last_opened_at.is_not(None))

        base = (
            select(
                Chart,
                func.coalesce(usage_sq.c.usage_count, 0).label("usage_count"),
            )
            .outerjoin(usage_sq, usage_sq.c.chart_id == Chart.id)
            .where(and_(*filters))
        )

        count_stmt = select(func.count()).select_from(base.subquery())
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        if facet == "recent":
            order = (Chart.last_opened_at.desc().nullslast(), Chart.updated_at.desc())
        elif facet == "favorites":
            order = (Chart.updated_at.desc(), Chart.title.asc())
        else:
            order = (Chart.updated_at.desc(), Chart.title.asc())

        stmt = base.order_by(*order).limit(limit).offset(offset)
        rows = (await self.db.execute(stmt)).all()

        # Prefetch dashboard titles for usage badges (cap per page)
        chart_ids = [r[0].id for r in rows]
        placements: Dict[str, List[Dict[str, str]]] = {str(cid): [] for cid in chart_ids}
        if chart_ids:
            place_stmt = (
                select(
                    DashboardChart.chart_id,
                    Dashboard.id,
                    Dashboard.name,
                )
                .join(Dashboard, Dashboard.id == DashboardChart.dashboard_id)
                .where(DashboardChart.chart_id.in_(chart_ids))
                .order_by(Dashboard.name.asc())
            )
            for chart_id, dash_id, dash_name in (await self.db.execute(place_stmt)).all():
                key = str(chart_id)
                if len(placements.get(key, [])) >= 5:
                    continue
                placements.setdefault(key, []).append(
                    {"id": str(dash_id), "name": dash_name or "Dashboard"}
                )

        items = []
        for chart, usage_count in rows:
            items.append(
                self.serialize_chart(
                    chart,
                    usage_count=int(usage_count or 0),
                    dashboards=placements.get(str(chart.id), []),
                    detail=detail,
                )
            )

        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasMore": offset + len(items) < total,
            "charts": items,
        }

    @staticmethod
    def serialize_chart(
        chart: Chart,
        *,
        usage_count: int = 0,
        dashboards: Optional[List[Dict[str, str]]] = None,
        detail: str = "summary",
    ) -> Dict[str, Any]:
        base = {
            "id": str(chart.id),
            "dataSourceId": chart.data_source_id,
            "chartType": chart.chart_type,
            "title": chart.title,
            "userId": str(chart.user_id) if chart.user_id else None,
            "projectId": str(chart.project_id) if chart.project_id else None,
            "collectionId": str(chart.collection_id) if chart.collection_id else None,
            "isFavorite": bool(getattr(chart, "is_favorite", False)),
            "lastOpenedAt": chart.last_opened_at.isoformat() if chart.last_opened_at else None,
            "tags": chart.tags if isinstance(getattr(chart, "tags", None), list) else [],
            "updatedAt": chart.updated_at.isoformat() if chart.updated_at else None,
            "createdAt": chart.created_at.isoformat() if chart.created_at else None,
            "usageCount": usage_count,
            "dashboards": dashboards or [],
            "scope": "library" if usage_count == 0 else "placed",
        }
        if detail == "full":
            base["chartQuery"] = chart.chart_query or {}
            base["chartOptions"] = chart.chart_options or {}
        return base

    def serialize_chart_instance(
        self,
        chart: Chart,
        *,
        usage_count: int = 0,
        dashboards: Optional[List[Dict[str, str]]] = None,
        detail: str = "summary",
    ) -> Dict[str, Any]:
        return self.serialize_chart(
            chart, usage_count=usage_count, dashboards=dashboards, detail=detail
        )

    async def touch_opened(self, chart: Chart) -> Chart:
        chart.last_opened_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(chart)
        return chart

    async def set_favorite(self, chart: Chart, is_favorite: bool) -> Chart:
        chart.is_favorite = bool(is_favorite)
        await self.db.commit()
        await self.db.refresh(chart)
        return chart

    async def assign_collection(
        self,
        chart: Chart,
        collection_id: Optional[uuid.UUID],
    ) -> Chart:
        chart.collection_id = collection_id
        await self.db.commit()
        await self.db.refresh(chart)
        return chart

    async def find_reusable_by_saved_query(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
        saved_query_id: str,
        chart_type: Optional[str] = None,
    ) -> Optional[Chart]:
        """Prefer an existing library chart bound to the same saved_query_id."""
        if not saved_query_id:
            return None
        filters = [
            self._scope_filter(user_id=user_id, project_id=project_id),
            Chart.chart_query["saved_query_id"].astext == str(saved_query_id),
        ]
        if chart_type:
            filters.append(Chart.chart_type == chart_type)
        stmt = (
            select(Chart)
            .where(and_(*filters))
            .order_by(Chart.updated_at.desc())
            .limit(1)
        )
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def usage_for_chart(self, chart_id: uuid.UUID) -> Tuple[int, List[Dict[str, str]]]:
        count_res = await self.db.execute(
            select(func.count())
            .select_from(DashboardChart)
            .where(DashboardChart.chart_id == chart_id)
        )
        count = int(count_res.scalar() or 0)
        place_stmt = (
            select(Dashboard.id, Dashboard.name)
            .join(DashboardChart, DashboardChart.dashboard_id == Dashboard.id)
            .where(DashboardChart.chart_id == chart_id)
            .order_by(Dashboard.name.asc())
            .limit(20)
        )
        dashboards = [
            {"id": str(did), "name": title or "Dashboard"}
            for did, title in (await self.db.execute(place_stmt)).all()
        ]
        return count, dashboards
