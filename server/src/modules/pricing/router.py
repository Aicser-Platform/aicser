"""Community Edition pricing API."""

from __future__ import annotations

from typing import Union

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.models import UserRole
from src.modules.data.models import DataSource
from src.modules.pricing.plans import PLAN_CONFIGS, get_plan_config
from src.modules.project.models import Project

router = APIRouter()


@router.get("/sku-catalog")
async def sku_catalog():
    return {
        "edition": "community",
        "skus": [
            {"id": "analyze", "name": "Analyze", "layer": "core", "nav_keys": ["dashboards", "data"]},
        ],
        "rule": "Community ships Analyze. Ask, Govern, and add-ons require Enterprise.",
    }


@router.get("/plans")
async def list_plans():
    return {"plans": PLAN_CONFIGS, "edition": "community"}


@router.get("/usage")
async def community_usage_summary(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """CE footprint + BYOK policy (EE shadows this router with full usage analytics)."""
    from src.core.edition import is_ee_enabled

    if is_ee_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use EE pricing usage")

    user_id = None
    if isinstance(current_token, dict):
        user_id = current_token.get("sub") or current_token.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    org_stmt = (
        select(UserRole.organization_id)
        .where(
            UserRole.user_id == str(user_id),
            UserRole.is_active == True,
            UserRole.is_deleted == False,
        )
        .limit(1)
    )
    org_id = (await db.execute(org_stmt)).scalar_one_or_none()

    ds_used = 0
    proj_used = 0
    if org_id:
        ds_stmt = (
            select(func.count())
            .select_from(DataSource)
            .join(Project, DataSource.project_id == Project.id)
            .where(
                Project.organization_id == org_id,
                Project.is_active == True,
                Project.is_deleted == False,
                DataSource.is_active == True,
            )
        )
        ds_used = (await db.execute(ds_stmt)).scalar() or 0
        proj_stmt = select(func.count()).select_from(Project).where(
            and_(
                Project.organization_id == org_id,
                Project.is_active == True,
                Project.is_deleted == False,
                Project.is_default == False,
            )
        )
        proj_used = (await db.execute(proj_stmt)).scalar() or 0

    free_cfg = get_plan_config("free")
    ds_limit = int(free_cfg.get("max_data_sources", 2) or 2)
    proj_limit = int(free_cfg.get("max_projects", 1) or 1)
    return {
        "success": True,
        "usage": {
            "edition": "community",
            "ai_usage_policy": "bring_your_own_provider_key",
            "data_sources_count": {
                "used": ds_used,
                "limit": ds_limit,
                "unlimited": False,
                "percentage": min(100, int((ds_used / ds_limit) * 100)) if ds_limit > 0 else 0,
            },
            "projects_count": {
                "used": proj_used,
                "limit": proj_limit,
                "unlimited": False,
                "percentage": min(100, int((proj_used / proj_limit) * 100)) if proj_limit > 0 else 0,
            },
        },
    }


@router.get("/current")
async def current_plan():
    from src.core.deployment_mode import is_self_host_deployment
    from src.core.edition import is_ee_enabled
    if is_self_host_deployment() and is_ee_enabled():
        return {
            "plan": "enterprise",
            "config": get_plan_config("enterprise"),
            "edition": "enterprise",
            "managed_ai": False,
            "ai_usage_policy": "bring_your_own_provider_key",
        }
    return {
        "plan": "free",
        "config": get_plan_config("free"),
        "edition": "community",
        "managed_ai": False,
        "ai_usage_policy": "bring_your_own_provider_key",
    }
