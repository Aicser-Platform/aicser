from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _resolve_user_id(user_payload: Any) -> Optional[str]:
    if isinstance(user_payload, dict):
        for key in ("id", "user_id", "sub"):
            value = user_payload.get(key)
            if value:
                return str(value)
    if isinstance(user_payload, str):
        return user_payload
    return None


async def enforce_publish_owner_edit(
    db: AsyncSession,
    dashboard_id: UUID,
    user_payload: Dict[str, Any] | Any,
) -> None:
    """
    Gate toggling a dashboard's anonymous public read access (config.is_public,
    see dashboards/router.py::publish_dashboard). This previously no-op'd
    unconditionally - any authenticated user, anywhere, could make any
    dashboard in the system publicly and anonymously readable regardless of
    ownership or role. Mirrors the read-side check in
    authentication.rbac_service.has_dashboard_access, but requires actual
    write authority (creator, org owner/admin, or dashboard:publish), not
    just dashboard:view.
    """
    from src.core.edition import is_ee_enabled
    from src.modules.dashboards.models import Dashboard
    from src.modules.project.models import Project

    uid = _resolve_user_id(user_payload)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    created_by = getattr(dashboard, "created_by", None)
    if created_by and str(created_by) == uid:
        return

    if not is_ee_enabled():
        # CE dashboards are private-per-creator (no project/org role model) -
        # only the creator (checked above) may toggle publish state.
        raise HTTPException(status_code=403, detail="Not authorized to publish this dashboard")

    project_id = getattr(dashboard, "project_id", None)
    if project_id:
        org_result = await db.execute(select(Project.organization_id).where(Project.id == project_id))
        org_id = org_result.scalar_one_or_none()
        if org_id:
            from src.modules.authentication.rbac.rbac_service import RBACService
            from src.modules.authentication.rbac_service import has_org_role

            if await RBACService.check_permission(uid, "dashboard:publish", str(org_id), str(project_id)):
                return
            if await has_org_role(user_payload, org_id, ["owner", "admin"]):
                return

    raise HTTPException(status_code=403, detail="Not authorized to publish this dashboard")
