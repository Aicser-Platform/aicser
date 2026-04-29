from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from src.db.session import get_async_session
from src.modules.charts.services.v2.dashboard_service import DashboardService
from src.modules.dashboards.dashboard_schema import (
    DashboardCreateRequest,
    DashboardUpdateRequest,
    DashboardResponse,
    DashboardListResponse,
)
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.dashboards.permissions import enforce_publish_owner_edit

router = APIRouter()


@router.get(
    "/",
    response_model=DashboardListResponse,
)
async def list_dashboards(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_session),
):

    service = DashboardService(db)
    dashboards = await service.list_by_project(project_id)

    return {"dashboards": dashboards}
    
@router.get(
    "/{dashboard_id}",
    response_model=DashboardResponse,
)
async def get_dashboard(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get a specific dashboard by ID.
    Accessible without authentication for shared/public viewing.
    """
    service = DashboardService(db)
    dashboard = await service.get_by_id(dashboard_id)

    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    return dashboard


@router.post(
    "/",
    response_model=DashboardResponse,
    status_code=201,
)
async def create_dashboard(
    project_id: UUID,
    payload: DashboardCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    service = DashboardService(db)
    dashboard = await service.create({
        "project_id": project_id,
        "title": payload.title,
        "config": payload.config,
    })
    return dashboard


@router.get(
    "/{dashboard_id}",
    response_model=DashboardResponse,
)
async def get_dashboard(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_async_session),
):
    service = DashboardService(db)
    dashboard = await service.get_by_id(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return dashboard

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

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    updated = await service.update(dashboard, payload.dict())
    return updated


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

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    await service.delete(dashboard)
