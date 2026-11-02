"""Share links: set one up from the app, and open one from anywhere."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, get_current_user
from src.modules.feed import publish_policy as policy
from src.modules.pricing.feature_gate import get_user_organization_id
from src.modules.share_links import service as S
from src.modules.share_links.models import ShareLink

router = APIRouter()


class LinkBody(BaseModel):
    kind: Literal["chart", "dashboard"]
    resource_id: UUID
    title: str = Field(default="", max_length=300)
    access: Literal["organization", "public"]
    live_data: bool = False
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=3650)
    password: Optional[str] = Field(default=None, min_length=4, max_length=72)
    clear_password: bool = False
    allowed_domains: List[str] = Field(default_factory=list, max_length=50)


class OpenBody(BaseModel):
    password: Optional[str] = Field(default=None, max_length=72)
    parent_origin: str = ""


def _user_id(token: Union[str, dict]) -> str:
    payload = token if isinstance(token, dict) else {}
    user_id = payload.get("id") or payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to do this.")
    return str(user_id)


async def _may_share(db: AsyncSession, kind: str, resource_id: str, user_id: str, token: Any) -> None:
    from src.modules.embed.router import _require_resource_access

    await _require_resource_access(db, resource_id, [kind], user_id)
    if kind == "dashboard":
        from src.modules.dashboards.permissions import enforce_publish_owner_edit

        await enforce_publish_owner_edit(db, UUID(resource_id), token)


async def _link_for_owner(db: AsyncSession, link_id: str, user_id: str, org_id: Optional[str]) -> ShareLink:
    link = await db.get(ShareLink, UUID(link_id))
    approver = bool(org_id) and user_id in {str(i) for i in await policy.approvers(db, org_id)}
    if link is None or (str(link.created_by) != user_id and not approver):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    return link


@router.get("")
async def get_link(kind: str, resource_id: UUID, token: Union[str, dict] = Depends(JWTCookieBearer()),
                   db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _user_id(token)
    await _may_share(db, kind, str(resource_id), user_id, token)
    link = await S.find(db, kind, str(resource_id))
    return {"link": S.to_dict(link) if link else None}


@router.put("")
async def save_link(body: LinkBody, token: Union[str, dict] = Depends(JWTCookieBearer()),
                    db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _user_id(token)
    await _may_share(db, body.kind, str(body.resource_id), user_id, token)
    org_id = await get_user_organization_id(user_id, db)
    link = await S.save(db, kind=body.kind, resource_id=str(body.resource_id), org_id=str(org_id) if org_id else None,
                        user_id=user_id, title=body.title, access=body.access, live_data=body.live_data,
                        expires_in_days=body.expires_in_days, password=body.password,
                        clear_password=body.clear_password, allowed_domains=body.allowed_domains)
    return {"link": S.to_dict(link)}


@router.post("/{link_id}/off")
async def turn_off(link_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                   db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _user_id(token)
    org_id = await get_user_organization_id(user_id, db)
    link = await _link_for_owner(db, link_id, user_id, str(org_id) if org_id else None)
    link.status = "off"
    await db.commit()
    await policy.audit("share_link_off", user_id=user_id, org_id=org_id, resource_type=link.kind, resource_id=str(link.resource_id))
    return {"link": S.to_dict(link)}


@router.post("/{link_id}/on")
async def turn_on(link_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                  db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Undo for turning a link off: it goes through the rules again, as it would if new."""
    user_id = _user_id(token)
    org_id = await get_user_organization_id(user_id, db)
    link = await _link_for_owner(db, link_id, user_id, str(org_id) if org_id else None)
    link.status = "active" if link.access == "organization" else await S._public_state(
        db, str(org_id) if org_id else None, user_id, link.title or "")
    await db.commit()
    return {"link": S.to_dict(link)}


async def _approver_org(token: Union[str, dict], db: AsyncSession) -> tuple:
    user_id = _user_id(token)
    org_id = await get_user_organization_id(user_id, db)
    if not org_id or user_id not in {str(i) for i in await policy.approvers(db, org_id)}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization owners and admins can do this.")
    return str(org_id), user_id


@router.get("/organization")
async def organization_links(token: Union[str, dict] = Depends(JWTCookieBearer()),
                             db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Every link that is on or waiting, for owners and admins (Settings › Publishing)."""
    org_id, _ = await _approver_org(token, db)
    rows = (await db.execute(select(ShareLink).where(
        ShareLink.organization_id == UUID(org_id), ShareLink.status != "off",
    ).order_by(ShareLink.updated_at.desc()).limit(200))).scalars().all()
    return {"links": [S.to_dict(r) for r in rows]}


@router.post("/{link_id}/approve")
async def approve(link_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                  db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    org_id, user_id = await _approver_org(token, db)
    link = await db.get(ShareLink, UUID(link_id))
    if link is None or str(link.organization_id) != org_id or link.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    if str(link.created_by) == user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Another approver needs to review this link.")
    await policy.require_outside_sharing(db, org_id)
    link.status = "active"
    await db.commit()
    await policy.audit("share_link_approved", user_id=user_id, org_id=org_id, resource_type=link.kind, resource_id=str(link.resource_id))
    return {"link": S.to_dict(link)}


@router.post("/open/{slug}")
async def open_link(slug: str, body: OpenBody, request: Request, db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """No sign-in needed for public links; organization links check who is asking."""
    try:
        viewer: Optional[Dict[str, Any]] = await get_current_user(request)
    except HTTPException:
        viewer = None
    return await S.open_link(db, slug, password=body.password, parent_origin=body.parent_origin.strip(), viewer=viewer)
