"""CRUD for saved dashboard templates (DashboardTemplate) - wires up a table
that has existed since the initial migration with full CRUD-ready fields
(is_public, is_featured, usage_count, rating, required_plan) but was never
actually used by any router or service. Org-scoped, same visibility model
as dashboards/reports themselves: a saved template is a shared team asset,
not a private preference.

Distinct from SAMPLE_DASHBOARD_TEMPLATES in charts/router.py, the 5
hardcoded built-in templates - those stay a static Python dict with no DB
row; get_dashboard_templates() merges both into one list for the gallery.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_

from src.db.session import async_session
from src.shared.repository import TenantScopedRepository

from .models import DashboardTemplate

MAX_NAME_LENGTH = 255


class DashboardTemplateAccessError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _serialize(template: DashboardTemplate) -> Dict[str, Any]:
    return {
        "id": str(template.id),
        "source": "saved",
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "template_config": template.template_config or {},
        "preview_image_url": template.preview_image_url,
        "is_public": bool(template.is_public),
        "is_featured": bool(template.is_featured),
        "usage_count": template.usage_count or 0,
        "rating": template.rating or 0.0,
        "required_plan": template.required_plan or "free",
        "created_by": str(template.created_by) if template.created_by else None,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


def _validate_name(name: str) -> str:
    clean = (name or "").strip()
    if not clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template name is required")
    if len(clean) > MAX_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template name must be {MAX_NAME_LENGTH} characters or fewer",
        )
    return clean


def _repo(organization_id: str) -> TenantScopedRepository:
    """Org-scoped repository for DashboardTemplate -- every query built
    from this is structurally confined to `organization_id`, so a template
    belonging to another org can't be reached by ID no matter what a
    caller passes in."""
    return TenantScopedRepository(DashboardTemplate, organization_id=UUID(organization_id))


async def list_saved_dashboard_templates(organization_id: Optional[str]) -> List[Dict[str, Any]]:
    if not organization_id:
        return []
    async with async_session() as db:
        stmt = (
            _repo(organization_id)
            .scoped_query()
            .where(DashboardTemplate.is_deleted.isnot(True))
            .order_by(DashboardTemplate.created_at.asc())
        )
        result = await db.execute(stmt)
        return [_serialize(t) for t in result.scalars().all()]


async def get_saved_dashboard_template(organization_id: str, template_id: str) -> DashboardTemplate:
    async with async_session() as db:
        return await _get_owned_template(db, organization_id, template_id)


async def _get_owned_template(db, organization_id: str, template_id: str) -> DashboardTemplate:
    try:
        template_uuid = UUID(template_id)
    except ValueError as exc:
        raise DashboardTemplateAccessError(404, "Template not found") from exc

    stmt = (
        _repo(organization_id)
        .scoped_query()
        .where(
            and_(
                DashboardTemplate.id == template_uuid,
                DashboardTemplate.is_deleted.isnot(True),
            )
        )
    )
    result = await db.execute(stmt)
    template = result.scalar_one_or_none()
    if template is None:
        raise DashboardTemplateAccessError(404, "Template not found")
    return template


async def save_dashboard_as_template(
    organization_id: str,
    user_id: Optional[str],
    name: str,
    template_config: Dict[str, Any],
    description: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    clean_name = _validate_name(name)
    async with async_session() as db:
        # organization_id is stamped by the repository itself -- not taken
        # from this dict -- so it can't drift from the scope above.
        template = await _repo(organization_id).create(
            {
                "name": clean_name,
                "description": description,
                "category": category,
                "template_config": template_config,
                "created_by": UUID(user_id) if user_id else None,
                "is_public": False,
                "usage_count": 0,
            },
            db=db,
        )
        # create(db=...) only flushes on an externally-managed session --
        # committing is the caller's responsibility, same as this file's
        # other functions.
        await db.commit()
        await db.refresh(template)
        return _serialize(template)


async def update_saved_dashboard_template(
    organization_id: str,
    template_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    async with async_session() as db:
        template = await _get_owned_template(db, organization_id, template_id)
        if name is not None:
            template.name = _validate_name(name)
        if description is not None:
            template.description = description
        if category is not None:
            template.category = category
        await db.commit()
        await db.refresh(template)
        return _serialize(template)


async def delete_saved_dashboard_template(organization_id: str, template_id: str) -> None:
    async with async_session() as db:
        template = await _get_owned_template(db, organization_id, template_id)
        template.is_deleted = True
        await db.commit()


async def increment_template_usage(organization_id: str, template_id: str) -> None:
    """Best-effort - a saved template being used to spin up a dashboard is
    the one piece of "industry standard" template-gallery telemetry
    (usage_count/rating already existed as columns) worth wiring up now;
    failures here must never block dashboard creation."""
    try:
        async with async_session() as db:
            template = await _get_owned_template(db, organization_id, template_id)
            template.usage_count = (template.usage_count or 0) + 1
            await db.commit()
    except Exception:
        pass
