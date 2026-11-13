"""Docs and Slides API. The browser edits, imports (.docx / .pptx) and exports; this module only stores
the editor's JSON with the same owner / project rules as notebooks and sheets."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller, caller_from_token
from src.modules.office_files import sharing
from src.modules.office_files.models import OfficeFile, OfficeFileShare
from src.modules.office_files.schemas import MAX_BODY_BYTES, MAX_META_KEYS, OfficeFileCreate, OfficeFileUpdate, OfficeKind
from src.modules.office_files.sharing import NOUNS
from src.modules.office_files.sharing_router import router as sharing_router

router = APIRouter()
# Fixed paths (people, approvals, links, remote) before "/{file_id}".
router.include_router(sharing_router)


def _uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


def check_body(body: Dict[str, Any]) -> Dict[str, Any]:
    """Refuse a body too large to store (pictures are kept inline)."""
    if len(json.dumps(body, separators=(",", ":"), default=str)) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="This file is too large to save. Use smaller pictures or split it.")
    return body


def serialize(f: OfficeFile, caller: Caller, *, with_body: bool = True, role: Optional[str] = None) -> Dict[str, Any]:
    role = role or ("owner" if str(f.user_id) == caller.user_id else "view")
    out: Dict[str, Any] = {
        "id": str(f.id),
        "kind": f.kind,
        "title": f.title,
        "meta": f.meta or {},
        "visibility": f.visibility,
        "version": f.version,
        "project_id": str(f.project_id) if f.project_id else None,
        "folder_id": str(f.folder_id) if f.folder_id else None,
        "is_owner": role == "owner",
        # owner | edit | view: what this person may do (shares approved by an organization owner or admin)
        "role": role,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }
    if with_body:
        out["body"] = f.body or {}
    return out


async def load(db: AsyncSession, file_id: str, caller: Caller, *, write: bool) -> tuple:
    """The file and the caller's role (owner | edit | view). Others get 404, as if it didn't exist."""
    f = await db.get(OfficeFile, _uuid(file_id))
    if not f or f.is_deleted:
        raise HTTPException(status_code=404, detail="File not found")
    role = await sharing.my_role(db, f, await sharing.user_ids(db, caller.user_id))
    if role is None:
        raise HTTPException(status_code=404, detail="File not found")
    if write and role == "view":
        raise HTTPException(status_code=403, detail=f"You can view this {NOUNS[f.kind]}. Make a copy to edit it.")
    return f, role


async def load_owned(db: AsyncSession, file_id: str, caller: Caller) -> OfficeFile:
    f, role = await load(db, file_id, caller, write=True)
    if role != "owner":
        raise HTTPException(status_code=403, detail=f"Only the owner can do this to the {NOUNS[f.kind]}.")
    return f


@router.get("")
async def list_files(
    kind: OfficeKind = Query(...),
    project_id: Optional[str] = Query(None, max_length=64),
    q: Optional[str] = Query(None, max_length=200),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Your documents or presentations in the current project, plus the ones shared with you (any project)."""
    caller = caller_from_token(current_token, project_id)
    await require_permission(caller.user_id, "query:execute", organization_id=caller.organization_id, project_id=caller.project_id)
    ids = await sharing.user_ids(db, caller.user_id)
    mine = [uuid.UUID(i) for i in ids if sharing._is_uuid(i)]
    org, proj = _uuid(caller.organization_id), _uuid(caller.project_id)
    shared = select(OfficeFileShare.file_id).where(
        OfficeFileShare.target == "person", OfficeFileShare.status == "active", OfficeFileShare.person_id.in_(mine))
    conds = [
        OfficeFile.kind == kind,
        OfficeFile.is_deleted.is_not(True),
        or_(
            and_(
                OfficeFile.user_id.in_(mine),
                OfficeFile.organization_id == org if org else OfficeFile.organization_id.is_(None),
                OfficeFile.project_id == proj if proj else OfficeFile.project_id.is_(None),
            ),
            OfficeFile.id.in_(shared),
        ),
    ]
    if q and q.strip():
        conds.append(OfficeFile.title.ilike(f"%{q.strip()}%"))
    # Only the list's columns: bodies can be megabytes of pictures.
    rows = (await db.execute(
        select(OfficeFile).where(and_(*conds)).order_by(OfficeFile.updated_at.desc()).limit(500)
    )).scalars().all()
    items = []
    for f in rows:
        items.append(serialize(f, caller, with_body=False, role=await sharing.my_role(db, f, ids)))
    return {"items": items}


async def _create(db: AsyncSession, caller: Caller, body: OfficeFileCreate) -> OfficeFile:
    await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id, project_id=caller.project_id)
    f = OfficeFile(
        kind=body.kind,
        title=body.title.strip()[:200] or "Untitled",
        body=check_body(body.body),
        meta=body.meta,
        user_id=_uuid(caller.user_id),
        organization_id=_uuid(caller.organization_id),
        project_id=_uuid(caller.project_id),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


@router.post("", status_code=201)
async def create_file(
    body: OfficeFileCreate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """A new document or presentation (blank, or converted from .docx / .pptx in the browser)."""
    caller = caller_from_token(current_token, body.project_id)
    return serialize(await _create(db, caller, body), caller, with_body=False)


@router.get("/{file_id}")
async def get_file(
    file_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    f, role = await load(db, file_id, caller, write=False)
    return serialize(f, caller, role=role)


@router.put("/{file_id}")
async def update_file(
    file_id: str,
    body: OfficeFileUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Save changes (the editor autosaves). ``version`` must match the stored one, so two tabs can't
    silently overwrite each other: the second gets a 409 and reloads."""
    caller = caller_from_token(current_token)
    f, role = await load(db, file_id, caller, write=True)
    if body.version != f.version:
        raise HTTPException(status_code=409, detail=f"This {NOUNS[f.kind]} changed somewhere else. Reload to see the latest version.")
    if body.title is not None:
        f.title = body.title.strip()[:200] or f.title
    if body.body is not None:
        f.body = check_body(body.body)
    if body.meta is not None:
        # Merged, not replaced: autosave sends counts (words, slides), and details set at creation (e.g. the
        # report a file was made from) must survive it.
        merged = {**(f.meta or {}), **body.meta}
        if len(merged) > MAX_META_KEYS:
            raise HTTPException(status_code=400, detail="Too many details.")
        f.meta = merged
    f.version = f.version + 1
    f.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(f)
    return serialize(f, caller, with_body=False, role=role)


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    file_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    caller = caller_from_token(current_token)
    f = await load_owned(db, file_id, caller)
    f.is_deleted = True
    f.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{file_id}/restore")
async def restore_file(
    file_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Undo a delete (the list offers Undo rather than asking to confirm)."""
    caller = caller_from_token(current_token)
    f = await db.get(OfficeFile, _uuid(file_id))
    if not f or str(f.user_id) not in await sharing.user_ids(db, caller.user_id):
        raise HTTPException(status_code=404, detail="File not found")
    f.is_deleted = False
    f.deleted_at = None
    await db.commit()
    await db.refresh(f)
    return serialize(f, caller, with_body=False)


@router.post("/{file_id}/duplicate", status_code=201)
async def duplicate_file(
    file_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """A private copy for the caller (also how someone else's shared file is made editable)."""
    caller = caller_from_token(current_token)
    src, _ = await load(db, file_id, caller, write=False)
    caller = caller_from_token(current_token, str(src.project_id) if src.project_id else None)
    copy = await _create(db, caller, OfficeFileCreate(
        kind=src.kind, title=f"{src.title} (copy)"[:200], body=src.body or {}, meta=src.meta or {},
        project_id=str(src.project_id) if src.project_id else None,
    ))
    return serialize(copy, caller, with_body=False)
