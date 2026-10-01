"""Project folders: one tree per project for every asset type (see models.py).

Charts and dashboards keep filing through their libraries' collection endpoints, which now
write this same tree; the other assets file through ``PUT /api/folders/file``.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller, caller_from_token
from src.modules.folders.models import AssetFolder

router = APIRouter()

AssetType = Literal["notebook", "sheet", "saved_query", "model", "decision"]


class FolderIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: Optional[str] = Field(None, max_length=64)
    project_id: Optional[str] = Field(None, max_length=64)


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    parent_id: Optional[str] = Field(None, max_length=64)
    # Move to the top of the tree (parent_id=None alone means "unchanged").
    to_top: bool = False


class FileIn(BaseModel):
    asset_type: AssetType
    asset_id: str = Field(..., max_length=64)
    folder_id: Optional[str] = Field(None, max_length=64)  # None = unfile


def _uuid(v: Optional[str]) -> Optional[uuid.UUID]:
    if not v:
        return None
    try:
        return uuid.UUID(str(v))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc


def _scope(caller: Caller):
    """This project's folders; without a project, the caller's own."""
    org, proj = _uuid(caller.organization_id), _uuid(caller.project_id)
    same_org = AssetFolder.organization_id == org if org else AssetFolder.organization_id.is_(None)
    if proj:
        return and_(same_org, AssetFolder.project_id == proj)
    return and_(same_org, AssetFolder.project_id.is_(None), AssetFolder.user_id == _uuid(caller.user_id))


def _json(f: AssetFolder) -> Dict[str, Any]:
    return {"id": str(f.id), "name": f.name, "parent_id": str(f.parent_id) if f.parent_id else None,
            "sort_order": f.sort_order or 0, "project_id": str(f.project_id) if f.project_id else None}


async def _load(db: AsyncSession, folder_id: str, caller: Caller) -> AssetFolder:
    f = (await db.execute(select(AssetFolder).where(AssetFolder.id == _uuid(folder_id), _scope(caller)))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Folder not found")
    return f


async def _unique_name(db: AsyncSession, caller: Caller, name: str, parent_id: Optional[uuid.UUID],
                       exclude: Optional[uuid.UUID] = None) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Give the folder a name.")
    conds = [_scope(caller), func.lower(AssetFolder.name) == cleaned.lower(),
             AssetFolder.parent_id == parent_id if parent_id else AssetFolder.parent_id.is_(None)]
    if exclude:
        conds.append(AssetFolder.id != exclude)
    if (await db.execute(select(AssetFolder.id).where(and_(*conds)).limit(1))).first():
        raise HTTPException(status_code=409, detail=f'There is already a folder called "{cleaned}" here.')
    return cleaned


async def _caller(token: Any, project_id: Optional[str], permission: str) -> Caller:
    caller = caller_from_token(token, project_id)
    await require_permission(caller.user_id, permission, organization_id=caller.organization_id, project_id=caller.project_id)
    return caller


@router.get("")
async def list_folders(project_id: Optional[str] = Query(None, max_length=64),
                       current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """The project's folder tree, flat (each folder names its parent)."""
    caller = await _caller(current_token, project_id, "query:execute")
    rows = (await db.execute(
        select(AssetFolder).where(_scope(caller)).order_by(AssetFolder.sort_order.asc(), AssetFolder.name.asc())
    )).scalars().all()
    return {"items": [_json(f) for f in rows]}


@router.post("", status_code=201)
async def create_folder(body: FolderIn, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = await _caller(current_token, body.project_id, "query:save")
    parent = await _load(db, body.parent_id, caller) if body.parent_id else None
    f = AssetFolder(name=await _unique_name(db, caller, body.name, parent.id if parent else None),
                    parent_id=parent.id if parent else None, organization_id=_uuid(caller.organization_id),
                    project_id=_uuid(caller.project_id), user_id=_uuid(caller.user_id))
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _json(f)


@router.patch("/{folder_id}")
async def update_folder(folder_id: str, body: FolderUpdate, project_id: Optional[str] = Query(None, max_length=64),
                        current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Rename, or move under another folder (never into itself or its own subfolders)."""
    caller = await _caller(current_token, project_id, "query:save")
    f = await _load(db, folder_id, caller)
    new_parent = f.parent_id
    if body.to_top:
        new_parent = None
    elif body.parent_id:
        target = await _load(db, body.parent_id, caller)
        # Walk up from the target: reaching this folder means it would contain itself.
        seen, cur = set(), target
        while cur is not None:
            if cur.id == f.id:
                raise HTTPException(status_code=400, detail="A folder can't go inside itself.")
            if cur.id in seen or not cur.parent_id:
                break
            seen.add(cur.id)
            cur = await db.get(AssetFolder, cur.parent_id)
        new_parent = target.id
    if body.name is not None or new_parent != f.parent_id:
        f.name = await _unique_name(db, caller, body.name if body.name is not None else f.name, new_parent, exclude=f.id)
    f.parent_id = new_parent
    await db.commit()
    await db.refresh(f)
    return _json(f)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: str, project_id: Optional[str] = Query(None, max_length=64),
                        current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> None:
    """Delete a folder: what was in it becomes unfiled and its subfolders move to the top."""
    caller = await _caller(current_token, project_id, "query:save")
    f = await _load(db, folder_id, caller)
    await db.delete(f)
    await db.commit()


# Where each asset keeps its folder, and who may file it.
_ASSETS: Dict[str, Dict[str, str]] = {
    "notebook": {"table": "notebooks", "owner": "user_id", "rule": "owner"},
    "sheet": {"table": "workbooks", "owner": "user_id", "rule": "owner"},
    "saved_query": {"table": "saved_queries", "owner": "user_id", "rule": "owner"},
    "model": {"table": "ml_models", "owner": "created_by", "rule": "project"},
    "decision": {"table": "ai_decision_definitions", "owner": "created_by", "rule": "project"},
}


@router.put("/file")
async def file_asset(body: FileIn, project_id: Optional[str] = Query(None, max_length=64),
                     current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                     db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Put an asset in a folder of its own project, or take it out (folder_id null)."""
    caller = await _caller(current_token, project_id, "query:save")
    spec = _ASSETS[body.asset_type]
    folder = await _load(db, body.folder_id, caller) if body.folder_id else None
    asset_id = body.asset_id.strip()
    # Ids compared as text: saved queries use integer ids, the other assets UUIDs.
    row = (await db.execute(
        text(f"SELECT {spec['owner']} AS owner, project_id FROM {spec['table']} WHERE CAST(id AS TEXT) = :id"),
        {"id": asset_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    if folder and str(row["project_id"] or "") != str(folder.project_id or ""):
        raise HTTPException(status_code=400, detail="That folder belongs to another project.")
    if spec["rule"] == "owner" and str(row["owner"]) != str(caller.user_id):
        raise HTTPException(status_code=403, detail="Only the owner can file this.")
    if spec["rule"] == "project":
        await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id,
                                 project_id=str(row["project_id"]) if row["project_id"] else None)
    await db.execute(
        text(f"UPDATE {spec['table']} SET folder_id = CAST(:fid AS uuid) WHERE CAST(id AS TEXT) = :id"),
        {"fid": str(folder.id) if folder else None, "id": asset_id},
    )
    await db.commit()
    return {"asset_type": body.asset_type, "asset_id": body.asset_id, "folder_id": str(folder.id) if folder else None}
