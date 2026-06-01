from fastapi import APIRouter, Depends, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Optional
from uuid import UUID
import json

from src.db.session import get_async_session
from src.core.edition import is_ee_enabled
from src.modules.charts.services.v2.dashboard_service import DashboardService
from src.modules.dashboards.dashboard_schema import (
    DashboardCreateRequest,
    DashboardUpdateRequest,
    DashboardResponse,
    DashboardListResponse,
)
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.authentication.rbac.guard import require_permission, user_id_from_payload
from src.modules.dashboards.permissions import enforce_publish_owner_edit
from src.modules.dashboards.pages_router import router as pages_router
from src.modules.dashboards import operations as dash_ops

router = APIRouter()

router.include_router(pages_router, prefix="/{dashboard_id}/pages", tags=["dashboard-pages"])


def _normalize_dashboard_config(config: Any) -> dict[str, Any]:
    if isinstance(config, dict):
        return config
    if isinstance(config, list):
        merged: dict[str, Any] = {}
        for item in config:
            if isinstance(item, dict):
                merged.update(item)
        return merged
    return {}


def _serialize_dashboard(dashboard: Any) -> dict[str, Any]:
    return {
        "id": getattr(dashboard, "id", None),
        "project_id": getattr(dashboard, "project_id", None),
        "title": getattr(dashboard, "title", None) or getattr(dashboard, "name", None),
        "description": getattr(dashboard, "description", None),
        "config": _normalize_dashboard_config(getattr(dashboard, "config", None)),
        "created_at": getattr(dashboard, "created_at", None),
        "updated_at": getattr(dashboard, "updated_at", None),
    }


@router.get(
    "/",
    response_model=DashboardListResponse,
)
async def list_dashboards(
    project_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    uid = user_id_from_payload(extract_user_payload(current_user) if current_user else {})
    await require_permission(uid, "dashboard:view", project_id=str(project_id) if project_id else None)
    service = DashboardService(db)
    if is_ee_enabled() and project_id:
        dashboards = await service.list_by_project(project_id)
    else:
        dashboards = await service.list_all()
    return {"dashboards": [_serialize_dashboard(dashboard) for dashboard in dashboards]}


@router.post(
    "/",
    response_model=DashboardResponse,
    status_code=201,
)
async def create_dashboard(
    payload: DashboardCreateRequest,
    project_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "dashboard:create", project_id=str(project_id) if project_id else None)
    service = DashboardService(db)
    dashboard = await service.create({
        "project_id": project_id if is_ee_enabled() else None,
        "title": payload.title,
        "config": payload.config,
    })
    return _serialize_dashboard(dashboard)


@router.get(
    "/{dashboard_id}",
    response_model=DashboardResponse,
)
async def get_dashboard(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    service = DashboardService(db)
    dashboard = await service.get_by_id(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return _serialize_dashboard(dashboard)

@router.put(
    "/{dashboard_id}",
    response_model=DashboardResponse,
)
async def update_dashboard(
    dashboard_id: UUID,
    payload: DashboardUpdateRequest,
    current_user: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):

    service = DashboardService(db)
    dashboard = await service.get_by_id(dashboard_id)

    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    uid = user_id_from_payload(extract_user_payload(current_user))
    project_id = getattr(dashboard, "project_id", None)
    await require_permission(uid, "dashboard:edit", project_id=str(project_id) if project_id else None)
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    updated = await service.update(dashboard, payload.dict())
    return _serialize_dashboard(updated)


@router.delete(
    "/{dashboard_id}",
    status_code=204,
)
async def delete_dashboard(
    dashboard_id: UUID,
    current_user: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    service = DashboardService(db)
    dashboard = await service.get_by_id(dashboard_id)

    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    uid = user_id_from_payload(extract_user_payload(current_user))
    project_id = getattr(dashboard, "project_id", None)
    await require_permission(uid, "dashboard:delete", project_id=str(project_id) if project_id else None)
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    await service.delete(dashboard)


@router.get("/{dashboard_id}/filter-options")
async def dashboard_filter_options(
    dashboard_id: UUID,
    field: str = Query(...),
    data_source_id: str = Query(...),
    table_name: Optional[str] = Query(None),
    runtime_filters: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Distinct values for global filters and slicers (supports cascading)."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )

    parsed_filters: list = []
    if runtime_filters:
        try:
            parsed = json.loads(runtime_filters)
            if isinstance(parsed, list):
                parsed_filters = parsed
        except json.JSONDecodeError:
            parsed_filters = []

    values = await dash_ops.get_filter_options(
        db,
        dashboard_id,
        field,
        data_source_id,
        table_name=table_name,
        runtime_filters=parsed_filters,
        exclude_field=field,
    )
    return {"values": values if isinstance(values, list) else []}


@router.get("/{dashboard_id}/filter-field-stats")
async def dashboard_filter_field_stats(
    dashboard_id: UUID,
    field: str = Query(...),
    data_source_id: str = Query(...),
    table_name: Optional[str] = Query(None),
    runtime_filters: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Min/max numeric bounds for slider filters and numeric slicers."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )

    parsed_filters: list = []
    if runtime_filters:
        try:
            parsed = json.loads(runtime_filters)
            if isinstance(parsed, list):
                parsed_filters = parsed
        except json.JSONDecodeError:
            parsed_filters = []

    stats = await dash_ops.get_filter_field_stats(
        db,
        dashboard_id,
        field,
        data_source_id,
        table_name=table_name,
        runtime_filters=parsed_filters,
    )
    return stats


@router.get("/{dashboard_id}/build-progress")
async def get_dashboard_build_progress(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Live AI build progress for Studio polling (auth-gated, ephemeral Redis session)."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    from src.modules.dashboards.build_session import get_build_session

    session = get_build_session(str(dashboard_id))
    if not session:
        return {"active": False, "dashboard_id": str(dashboard_id)}
    return {"active": session.get("status") == "building", **session}


@router.get("/{dashboard_id}/build-progress/stream")
async def stream_dashboard_build_progress(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """SSE stream for live AI dashboard builds — same event types as chat analyze."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    from src.modules.dashboards.build_session import iter_build_progress_sse

    return StreamingResponse(
        iter_build_progress_sse(str(dashboard_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{dashboard_id}/refresh")
async def refresh_dashboard(
    dashboard_id: UUID,
    payload: dict = Body(default_factory=dict),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Batch-execute chart queries for a dashboard (one HTTP round-trip, pooled DB connections)."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )

    charts = payload.get("charts") if isinstance(payload, dict) else None
    if charts is None:
        charts = []
    if not isinstance(charts, list):
        raise HTTPException(status_code=400, detail="charts must be a list")

    return await dash_ops.refresh_dashboard_charts(db, dashboard_id, charts)


@router.get("/{dashboard_id}/embed")
async def get_dashboard_embed(
    dashboard_id: UUID,
    page_id: Optional[str] = Query(None),
    runtime_filters: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Embed/share payload with saved layout, optional page and runtime filters."""
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )

    parsed_filters: list = []
    if runtime_filters:
        try:
            parsed = json.loads(runtime_filters)
            if isinstance(parsed, list):
                parsed_filters = parsed
        except json.JSONDecodeError:
            try:
                from urllib.parse import unquote
                raw = unquote(runtime_filters)
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    parsed_filters = parsed
            except Exception:
                parsed_filters = []

    return await dash_ops.build_embed_payload(
        db,
        dashboard_id,
        page_id=page_id,
        runtime_filters=parsed_filters or None,
    )


@router.post("/{dashboard_id}/publish")
async def publish_dashboard(
    dashboard_id: UUID,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    """Toggle anonymous read access via config.is_public."""
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    make_public = bool(payload.get("is_public", True)) if isinstance(payload, dict) else True
    return await dash_ops.publish_dashboard(db, dashboard_id, make_public)
