"""
Dashboard library: paginated lists, collections, favorites, chart counts.
Single source of truth for Studio / pin / visualize pickers at scale.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from src.modules.dashboards.models import Dashboard, DashboardChart, DashboardCollection


class DashboardLibraryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _scope_filter(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
    ):
        if project_id is not None:
            return Dashboard.project_id == project_id
        # CE: own dashboards + legacy unowned rows
        if user_id is not None:
            return or_(Dashboard.created_by == user_id, Dashboard.created_by.is_(None))
        return Dashboard.created_by.is_(None)

    def _collection_scope(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
    ):
        if project_id is not None:
            return DashboardCollection.project_id == project_id
        if user_id is not None:
            return and_(
                DashboardCollection.user_id == user_id,
                DashboardCollection.project_id.is_(None),
            )
        return DashboardCollection.project_id.is_(None)

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
            func.lower(func.trim(DashboardCollection.name)) == cleaned.lower(),
        ]
        if exclude_id is not None:
            filters.append(DashboardCollection.id != exclude_id)
        exists = await self.db.execute(select(DashboardCollection.id).where(and_(*filters)).limit(1))
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
    ) -> List[DashboardCollection]:
        stmt = (
            select(DashboardCollection)
            .where(self._collection_scope(user_id=user_id, project_id=project_id))
            .order_by(DashboardCollection.sort_order.asc(), DashboardCollection.name.asc())
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
    ) -> DashboardCollection:
        cleaned = await self._ensure_unique_collection_name(
            name=name, user_id=user_id, project_id=project_id
        )
        row = DashboardCollection(
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
        collection: DashboardCollection,
        *,
        name: Optional[str] = None,
        parent_id: Optional[uuid.UUID] = None,
        sort_order: Optional[int] = None,
        clear_parent: bool = False,
    ) -> DashboardCollection:
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

    async def delete_collection(self, collection: DashboardCollection) -> None:
        # Industry default: delete folder → items become unfiled (not destroyed)
        await self.db.execute(
            text("UPDATE dashboards SET collection_id = NULL WHERE collection_id = :cid"),
            {"cid": str(collection.id)},
        )
        await self.db.delete(collection)
        await self.db.commit()

    async def get_collection(self, collection_id: uuid.UUID) -> Optional[DashboardCollection]:
        res = await self.db.execute(
            select(DashboardCollection).where(DashboardCollection.id == collection_id)
        )
        return res.scalar_one_or_none()

    async def list_library(
        self,
        *,
        user_id: Optional[uuid.UUID],
        project_id: Optional[uuid.UUID],
        q: Optional[str] = None,
        facet: str = "all",
        collection_id: Optional[uuid.UUID] = None,
        limit: int = 50,
        offset: int = 0,
        detail: str = "summary",
    ) -> Dict[str, Any]:
        limit = max(1, min(int(limit or 50), 200))
        offset = max(0, int(offset or 0))
        facet = (facet or "all").strip().lower()
        detail = (detail or "summary").strip().lower()

        chart_count_sq = (
            select(
                DashboardChart.dashboard_id.label("dashboard_id"),
                func.count(DashboardChart.id).label("chart_count"),
            )
            .group_by(DashboardChart.dashboard_id)
            .subquery()
        )

        filters = [self._scope_filter(user_id=user_id, project_id=project_id)]
        # Soft-delete / trash facet
        if hasattr(Dashboard, "is_deleted"):
            if facet == "trash":
                filters.append(Dashboard.is_deleted.is_(True))
            else:
                filters.append(or_(Dashboard.is_deleted.is_(False), Dashboard.is_deleted.is_(None)))

        if q and q.strip():
            like = f"%{q.strip()}%"
            filters.append(or_(Dashboard.name.ilike(like), Dashboard.description.ilike(like)))
        if collection_id is not None:
            filters.append(Dashboard.collection_id == collection_id)

        if facet == "favorites":
            filters.append(Dashboard.is_favorite.is_(True))
        elif facet == "unfiled":
            filters.append(Dashboard.collection_id.is_(None))
        # facet == "recent" | "all" | "trash" — ordering differs below

        base = (
            select(
                Dashboard,
                func.coalesce(chart_count_sq.c.chart_count, 0).label("chart_count"),
            )
            .outerjoin(chart_count_sq, chart_count_sq.c.dashboard_id == Dashboard.id)
            .where(and_(*filters))
        )

        count_stmt = select(func.count()).select_from(base.subquery())
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        if facet == "recent":
            order = (Dashboard.last_opened_at.desc().nullslast(), Dashboard.updated_at.desc())
        elif facet == "favorites":
            order = (Dashboard.updated_at.desc(), Dashboard.name.asc())
        else:
            order = (Dashboard.updated_at.desc(), Dashboard.name.asc())

        stmt = base.order_by(*order).limit(limit).offset(offset)
        rows = (await self.db.execute(stmt)).all()

        items = [
            self.serialize_dashboard(
                dash,
                chart_count=int(chart_count or 0),
                detail=detail,
            )
            for dash, chart_count in rows
        ]
        return {
            "dashboards": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasMore": offset + len(items) < total,
        }

    @staticmethod
    def serialize_collection(row: DashboardCollection) -> Dict[str, Any]:
        return {
            "id": str(row.id),
            "name": row.name,
            "parentId": str(row.parent_id) if row.parent_id else None,
            "sortOrder": int(row.sort_order or 0),
            "projectId": str(row.project_id) if row.project_id else None,
        }

    @staticmethod
    def serialize_dashboard(
        dashboard: Dashboard,
        *,
        chart_count: int = 0,
        detail: str = "summary",
    ) -> Dict[str, Any]:
        tags = getattr(dashboard, "tags", None) or []
        if not isinstance(tags, list):
            tags = []
        cfg = dashboard.config if isinstance(dashboard.config, dict) else {}
        # Prefer first-class tags; fall back to config.tags for older clients
        if not tags and isinstance(cfg.get("tags"), list):
            tags = cfg["tags"]

        base: Dict[str, Any] = {
            "id": dashboard.id,
            "project_id": getattr(dashboard, "project_id", None),
            "title": dashboard.name,
            "name": dashboard.name,
            "description": dashboard.description,
            "collectionId": str(dashboard.collection_id) if getattr(dashboard, "collection_id", None) else None,
            "isFavorite": bool(getattr(dashboard, "is_favorite", False)),
            "lastOpenedAt": getattr(dashboard, "last_opened_at", None),
            "tags": tags,
            "chartCount": chart_count,
            "created_at": getattr(dashboard, "created_at", None),
            "updated_at": getattr(dashboard, "updated_at", None),
        }
        if detail == "full":
            base["config"] = cfg
        else:
            # Keep config light: only keys Studio needs without full layouts
            light = {}
            for key in ("tags", "default_color_palette", "feed_post_id", "feed_snapshot_version"):
                if key in cfg:
                    light[key] = cfg[key]
            base["config"] = light
        return base

    async def touch(self, dashboard: Dashboard) -> Dashboard:
        dashboard.last_opened_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard

    async def set_favorite(self, dashboard: Dashboard, is_favorite: bool) -> Dashboard:
        dashboard.is_favorite = bool(is_favorite)
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard

    async def assign_collection(
        self,
        dashboard: Dashboard,
        collection_id: Optional[uuid.UUID],
    ) -> Dashboard:
        dashboard.collection_id = collection_id
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard

    async def set_tags(self, dashboard: Dashboard, tags: List[str]) -> Dashboard:
        cleaned = [str(t).strip() for t in (tags or []) if str(t).strip()]
        dashboard.tags = cleaned
        # Keep config.tags in sync for older UI paths
        cfg = dict(dashboard.config) if isinstance(dashboard.config, dict) else {}
        cfg["tags"] = cleaned
        dashboard.config = cfg
        await self.db.commit()
        await self.db.refresh(dashboard)
        return dashboard
