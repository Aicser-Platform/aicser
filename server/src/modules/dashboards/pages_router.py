"""Dashboard pages API — /api/dashboards/{dashboard_id}/pages"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.dashboards.pages_service import DashboardPagesService
from src.modules.dashboards.permissions import enforce_publish_owner_edit
from src.modules.dashboards import operations as dash_ops
from src.shared.access_control import enforce_permission, extract_user_id, check_dashboard_access

router = APIRouter()


class PageCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    page_order: Optional[int] = None


class PageUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    page_order: Optional[int] = None
    layout_config: Optional[Dict[str, Any]] = None
    filters: Optional[List[Any]] = None


class PageReorderRequest(BaseModel):
    page_ids: List[str]


def _serialize_page(page) -> dict:
    return {
        "id": str(page.id),
        "dashboard_id": str(page.dashboard_id),
        "name": page.name,
        "description": page.description,
        "page_order": page.page_order,
        "layout_config": page.layout_config or {},
        "filters": page.filters or [],
    }


@router.get("")
async def list_pages(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await dash_ops.verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    svc = DashboardPagesService(db)
    pages = await svc.list_pages(dashboard_id)
    if not pages:
        pages = [await svc.create_page(dashboard_id, "Page 1")]
    return {"pages": [_serialize_page(p) for p in pages]}


@router.post("", status_code=201)
async def create_page(
    dashboard_id: UUID,
    body: PageCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    svc = DashboardPagesService(db)
    page = await svc.create_page(dashboard_id, body.name, body.description, body.page_order)
    return _serialize_page(page)


@router.put("/reorder")
async def reorder_pages(
    dashboard_id: UUID,
    body: PageReorderRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    svc = DashboardPagesService(db)
    pages = await svc.reorder_pages(dashboard_id, body.page_ids)
    return {"pages": [_serialize_page(p) for p in pages]}


@router.put("/{page_id}")
async def update_page(
    dashboard_id: UUID,
    page_id: UUID,
    body: PageUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    svc = DashboardPagesService(db)
    page = await svc.update_page(page_id, body.model_dump(exclude_unset=True))
    if not page or str(page.dashboard_id) != str(dashboard_id):
        raise HTTPException(status_code=404, detail="Page not found")
    return _serialize_page(page)


@router.delete("/{page_id}", status_code=204)
async def delete_page(
    dashboard_id: UUID,
    page_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    from src.modules.dashboards.models import DashboardPage

    user_id = extract_user_id(current_user)
    if is_ee_enabled():
        await enforce_permission(user_id, "dashboard:edit")
    await check_dashboard_access(current_user, str(dashboard_id))
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    page_obj = await db.get(DashboardPage, page_id)
    if not page_obj or str(page_obj.dashboard_id) != str(dashboard_id):
        raise HTTPException(status_code=404, detail="Page not found")
    svc = DashboardPagesService(db)
    await svc.delete_page(page_id)
