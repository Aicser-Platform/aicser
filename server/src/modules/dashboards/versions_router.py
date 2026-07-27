"""Dashboard version history API — /api/dashboards/{dashboard_id}/versions

Server-backed replacement for the localStorage-only "Version History" drawer:
named snapshots of a dashboard's widgets/layout, shared across teammates and
devices instead of trapped in one browser's storage.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.dashboards.versions_service import DashboardVersionsService
from src.modules.dashboards.permissions import enforce_publish_owner_edit
from src.modules.dashboards import operations as dash_ops
from src.shared.access_control import enforce_permission, extract_user_id, check_dashboard_access

router = APIRouter()


class VersionCreateRequest(BaseModel):
    label: Optional[str] = None
    config: Dict[str, Any]


def _serialize_version_summary(version) -> dict:
    """Lightweight shape for the list endpoint — omits widgets/layout payload."""
    config = version.config if isinstance(version.config, dict) else {}
    widgets = config.get("widgets")
    return {
        "id": str(version.id),
        "dashboardId": str(version.dashboard_id),
        "label": version.label or "",
        "savedAt": int(version.created_at.timestamp() * 1000) if version.created_at else None,
        "widgetCount": len(widgets) if isinstance(widgets, list) else 0,
    }


def _serialize_version_full(version) -> dict:
    """Full shape used for restore — includes the widgets/layout snapshot."""
    config = version.config if isinstance(version.config, dict) else {}
    return {
        "id": str(version.id),
        "dashboardId": str(version.dashboard_id),
        "label": version.label or "",
        "savedAt": int(version.created_at.timestamp() * 1000) if version.created_at else None,
        "widgets": config.get("widgets") or [],
        "layout": config.get("layout") or [],
    }


@router.get("")
async def list_versions(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    svc = DashboardVersionsService(db)
    versions = await svc.list_versions(dashboard_id)
    return {"versions": [_serialize_version_summary(v) for v in versions]}


@router.post("", status_code=201)
async def create_version(
    dashboard_id: UUID,
    body: VersionCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    created_by: Optional[UUID] = None
    try:
        created_by = UUID(str(user_id))
    except (ValueError, TypeError):
        created_by = None

    svc = DashboardVersionsService(db)
    version = await svc.create_version(dashboard_id, body.label, body.config, created_by)
    return _serialize_version_full(version)


@router.get("/{version_id}")
async def get_version(
    dashboard_id: UUID,
    version_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    svc = DashboardVersionsService(db)
    version = await svc.get_version(dashboard_id, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return _serialize_version_full(version)


@router.delete("/{version_id}", status_code=204)
async def delete_version(
    dashboard_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    svc = DashboardVersionsService(db)
    deleted = await svc.delete_version(dashboard_id, version_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Version not found")
