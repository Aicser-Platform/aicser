"""CRUD for dashboard version snapshots (Studio "Version History").

Server-backed replacement for the old localStorage-only history — see
DashboardVersion in models.py for the schema rationale.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.dashboards.models import DashboardVersion

# Matches the old client-side MAX_VERSIONS cap in useDashboardStore.ts.
MAX_VERSIONS = 20


class DashboardVersionsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_versions(self, dashboard_id: UUID) -> List[DashboardVersion]:
        stmt = (
            select(DashboardVersion)
            .where(DashboardVersion.dashboard_id == dashboard_id)
            .order_by(DashboardVersion.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def get_version(self, dashboard_id: UUID, version_id: UUID) -> Optional[DashboardVersion]:
        version = await self.db.get(DashboardVersion, version_id)
        if not version or str(version.dashboard_id) != str(dashboard_id):
            return None
        return version

    async def create_version(
        self,
        dashboard_id: UUID,
        label: Optional[str],
        config: Dict[str, Any],
        created_by: Optional[UUID],
    ) -> DashboardVersion:
        version = DashboardVersion(
            dashboard_id=dashboard_id,
            label=label,
            config=config,
            created_by=created_by,
        )
        self.db.add(version)
        await self.db.commit()
        await self.db.refresh(version)

        await self._enforce_cap(dashboard_id)
        return version

    async def delete_version(self, dashboard_id: UUID, version_id: UUID) -> bool:
        version = await self.get_version(dashboard_id, version_id)
        if not version:
            return False
        await self.db.delete(version)
        await self.db.commit()
        return True

    async def _enforce_cap(self, dashboard_id: UUID, max_versions: int = MAX_VERSIONS) -> None:
        """Delete the oldest snapshots beyond max_versions for this dashboard."""
        stmt = (
            select(DashboardVersion.id)
            .where(DashboardVersion.dashboard_id == dashboard_id)
            .order_by(DashboardVersion.created_at.desc())
            .offset(max_versions)
        )
        result = await self.db.execute(stmt)
        stale_ids = [row[0] for row in result.all()]
        if not stale_ids:
            return
        await self.db.execute(delete(DashboardVersion).where(DashboardVersion.id.in_(stale_ids)))
        await self.db.commit()
