"""Business domains API: group semantic models into Sales, Finance… and mark the Core model."""

from __future__ import annotations

import uuid
from typing import Literal, Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller, caller_from_token, load_source_for
from src.modules.semantic_domains.models import SemanticDomain, SemanticDomainSource

router = APIRouter()


class DomainIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_core: bool = False
    steward_ids: List[str] = Field(default_factory=list, max_length=50)


class DomainPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_core: Optional[bool] = None
    steward_ids: Optional[List[str]] = Field(default=None, max_length=50)


def _uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


async def _caller(current_token, db: AsyncSession, requested_org: Optional[str]) -> Caller:
    """The caller with their organization: from the token, else the one they chose (membership-checked)."""
    import dataclasses

    from src.modules.pricing.feature_gate import get_user_organization_id

    caller = caller_from_token(current_token)
    if caller.organization_id:
        return caller
    org = await get_user_organization_id(caller.user_id, db, requested_org.strip() if isinstance(requested_org, str) else None)
    if not org:
        raise HTTPException(status_code=403, detail="Choose an organization first.")
    return dataclasses.replace(caller, organization_id=str(org))


def _org_filter(caller: Caller):
    org = _uuid(caller.organization_id)
    return SemanticDomain.organization_id == org if org else SemanticDomain.organization_id.is_(None)


async def _can_edit(caller: Caller) -> None:
    await require_permission(caller.user_id, "semantic:edit", organization_id=caller.organization_id)


async def _load(db: AsyncSession, domain_id: str, caller: Caller) -> SemanticDomain:
    domain = (await db.execute(select(SemanticDomain).where(SemanticDomain.id == _uuid(domain_id), _org_filter(caller)))).scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    return domain


async def _only_core(db: AsyncSession, caller: Caller, keep: uuid.UUID) -> None:
    """One Core model per organization."""
    await db.execute(update(SemanticDomain).where(_org_filter(caller), SemanticDomain.id != keep).values(is_core=False))


def _serialize(domain: SemanticDomain, source_ids: List[str]) -> Dict[str, Any]:
    return {
        "id": str(domain.id),
        "name": domain.name,
        "description": domain.description,
        "is_core": bool(domain.is_core),
        "steward_ids": list(domain.steward_ids or []),
        "owner_id": str(domain.owner_id) if domain.owner_id else None,
        "source_ids": source_ids,
    }


@router.get("")
async def list_domains(current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = await _caller(current_token, db, x_org)
    await require_permission(caller.user_id, "semantic:view", organization_id=caller.organization_id)
    domains = (await db.execute(select(SemanticDomain).where(_org_filter(caller)).order_by(
        SemanticDomain.is_core.desc(), SemanticDomain.name))).scalars().all()
    links = (await db.execute(select(SemanticDomainSource).where(
        SemanticDomainSource.domain_id.in_([d.id for d in domains] or [uuid.uuid4()])))).scalars().all()
    by_domain: Dict[uuid.UUID, List[str]] = {}
    for link in links:
        by_domain.setdefault(link.domain_id, []).append(link.data_source_id)
    return {"domains": [_serialize(d, by_domain.get(d.id, [])) for d in domains]}


@router.post("", status_code=201)
async def create_domain(req: DomainIn, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    exists = (await db.execute(select(SemanticDomain.id).where(_org_filter(caller), SemanticDomain.name == req.name.strip()))).first()
    if exists:
        raise HTTPException(status_code=409, detail="A domain with this name already exists.")
    domain = SemanticDomain(
        organization_id=_uuid(caller.organization_id),
        name=req.name.strip(),
        description=req.description,
        is_core=req.is_core,
        steward_ids=req.steward_ids,
        owner_id=_uuid(caller.user_id),
        created_by=_uuid(caller.user_id),
    )
    db.add(domain)
    await db.flush()
    if req.is_core:
        await _only_core(db, caller, domain.id)
    await db.commit()
    return _serialize(domain, [])


@router.patch("/{domain_id}")
async def update_domain(domain_id: str, req: DomainPatch, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    domain = await _load(db, domain_id, caller)
    if req.name is not None:
        domain.name = req.name.strip()
    if req.description is not None:
        domain.description = req.description
    if req.steward_ids is not None:
        domain.steward_ids = req.steward_ids
    if req.is_core is not None:
        domain.is_core = req.is_core
        if req.is_core:
            await _only_core(db, caller, domain.id)
    await db.commit()
    links = (await db.execute(select(SemanticDomainSource.data_source_id).where(SemanticDomainSource.domain_id == domain.id))).scalars().all()
    return _serialize(domain, list(links))


@router.delete("/{domain_id}", status_code=204)
async def delete_domain(domain_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                        db: AsyncSession = Depends(get_async_session)) -> None:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    domain = await _load(db, domain_id, caller)
    await db.delete(domain)
    await db.commit()


@router.put("/{domain_id}/sources/{data_source_id}", status_code=204)
async def add_source(domain_id: str, data_source_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                     db: AsyncSession = Depends(get_async_session)) -> None:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    domain = await _load(db, domain_id, caller)
    await load_source_for(caller, data_source_id)  # must be able to query it
    exists = (await db.execute(select(SemanticDomainSource.id).where(
        SemanticDomainSource.domain_id == domain.id, SemanticDomainSource.data_source_id == data_source_id))).first()
    if not exists:
        db.add(SemanticDomainSource(domain_id=domain.id, data_source_id=data_source_id, added_by=_uuid(caller.user_id)))
        await db.commit()


@router.delete("/{domain_id}/sources/{data_source_id}", status_code=204)
async def remove_source(domain_id: str, data_source_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                        db: AsyncSession = Depends(get_async_session)) -> None:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    domain = await _load(db, domain_id, caller)
    await db.execute(delete(SemanticDomainSource).where(
        SemanticDomainSource.domain_id == domain.id, SemanticDomainSource.data_source_id == data_source_id))
    await db.commit()


class CalendarIn(BaseModel):
    fiscal_year_start_month: int = Field(1, ge=1, le=12)
    week_start: Literal["monday", "sunday"] = "monday"


@router.get("/calendar")
async def get_calendar(current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """The organization calendar every time dimension uses (kept on the Core domain)."""
    from src.modules.semantic_domains.core import org_calendar

    caller = await _caller(current_token, db, x_org)
    await require_permission(caller.user_id, "semantic:view", organization_id=caller.organization_id)
    return await org_calendar(db, organization_id=caller.organization_id)


@router.put("/calendar")
async def set_calendar(req: CalendarIn, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = await _caller(current_token, db, x_org)
    await _can_edit(caller)
    core = (await db.execute(select(SemanticDomain).where(_org_filter(caller), SemanticDomain.is_core.is_(True)))).scalar_one_or_none()
    if core is None:
        # The calendar belongs to the Core model; create it the first time someone sets one.
        taken = set((await db.execute(select(SemanticDomain.name).where(_org_filter(caller)))).scalars().all())
        name = next(n for n in ("Core", "Core model", f"Core {uuid.uuid4().hex[:4]}") if n not in taken)
        core = SemanticDomain(organization_id=_uuid(caller.organization_id), name=name, is_core=True,
                              description="Shared dimensions and calendar for every domain.",
                              owner_id=_uuid(caller.user_id), created_by=_uuid(caller.user_id))
        db.add(core)
    core.calendar = req.model_dump()
    await db.commit()
    return core.calendar


@router.get("/core-dimensions")
async def list_core_dimensions(data_source_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                               x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
                               db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """The Core model's dimensions as seen from one connection, and whether each can be used there."""
    from src.modules.semantic_domains.core import core_dimensions

    caller = await _caller(current_token, db, x_org)
    await require_permission(caller.user_id, "semantic:view", organization_id=caller.organization_id)
    await load_source_for(caller, data_source_id)  # must be able to open this connection
    return {"dimensions": await core_dimensions(db, caller.organization_id, data_source_id)}
