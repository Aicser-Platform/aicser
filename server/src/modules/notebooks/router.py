"""Notebooks API. SQL cells run through the query editor's own endpoint (row security applies
there); Python runs in the viewer's browser, so no code is ever executed on the server. This
module only stores notebooks and turns results into datasets."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller, caller_from_token
from src.modules.dashboards.comments_router import CommentCreate, CommentUpdate
from src.modules.notebooks import comments, ipynb
from src.modules.notebooks.models import Notebook, NotebookVersion
from src.shared.middleware.rate_limiter import rate_limit
from src.modules.notebooks.schemas import (
    MAX_NOTEBOOK_BYTES,
    Cell,
    NotebookCreate,
    NotebookImport,
    NotebookUpdate,
    SaveDatasetRequest,
)

router = APIRouter()

# Version history: one point per person per working session, the last MAX_HISTORY kept.
SESSION_GAP = timedelta(minutes=10)
MAX_HISTORY = 100


def _uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


def _cells_json(cells: List[Cell]) -> List[Dict[str, Any]]:
    data = [c.model_dump(exclude_none=True) for c in cells]
    if len(json.dumps(data, default=str)) > MAX_NOTEBOOK_BYTES:
        raise HTTPException(status_code=413, detail="This notebook is too large to save. Clear some cell outputs or split it.")
    ids = [c["id"] for c in data]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="Two cells have the same id.")
    return data


def _serialize(nb: Notebook, caller: Caller, *, with_cells: bool = True) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": str(nb.id),
        "title": nb.title,
        "description": nb.description,
        "visibility": nb.visibility,
        "version": nb.version,
        "project_id": str(nb.project_id) if nb.project_id else None,
        "folder_id": str(nb.folder_id) if nb.folder_id else None,
        "is_owner": str(nb.user_id) == caller.user_id,
        "cell_count": len(nb.cells or []),
        "created_at": nb.created_at.isoformat() if nb.created_at else None,
        "updated_at": nb.updated_at.isoformat() if nb.updated_at else None,
    }
    if with_cells:
        out["cells"] = nb.cells or []
    return out


async def _can_read_project(caller: Caller, project_id: Optional[uuid.UUID]) -> bool:
    try:
        await require_permission(
            caller.user_id, "query:execute", organization_id=caller.organization_id,
            project_id=str(project_id) if project_id else None,
        )
        return True
    except HTTPException:
        return False


async def _load(db: AsyncSession, notebook_id: str, caller: Caller, *, write: bool) -> Notebook:
    nb = await db.get(Notebook, _uuid(notebook_id))
    if not nb or nb.is_deleted:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if str(nb.user_id) == caller.user_id:
        return nb
    shared = nb.visibility == "project" and (
        (nb.organization_id and caller.organization_id and str(nb.organization_id) == caller.organization_id)
        or (not nb.organization_id and not caller.organization_id)
    )
    if not shared or not await _can_read_project(caller, nb.project_id):
        raise HTTPException(status_code=404, detail="Notebook not found")
    if write:
        raise HTTPException(status_code=403, detail="Only the owner can change this notebook. Make a copy to edit it.")
    return nb


def _code_only(cells: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{k: v for k, v in c.items() if k != "output"} for c in (cells or [])]


async def _snapshot(db: AsyncSession, nb: Notebook, author_id: str, reason: str = "save") -> None:
    """Record the notebook as it now is. A save by the same person soon after the last point
    updates that point instead of adding one; restores always add one."""
    now = datetime.now(timezone.utc)
    cells = _code_only(nb.cells or [])
    last = (await db.execute(
        select(NotebookVersion).where(NotebookVersion.notebook_id == nb.id)
        .order_by(NotebookVersion.updated_at.desc()).limit(1)
    )).scalar_one_or_none()
    if last and last.cells == cells and last.title == nb.title:
        return  # nothing but outputs changed
    if (reason == "save" and last and last.reason == "save" and str(last.author_id) == str(author_id)
            and last.updated_at and now - last.updated_at < SESSION_GAP):
        last.cells, last.title, last.notebook_version, last.updated_at = cells, nb.title, nb.version, now
        return
    db.add(NotebookVersion(notebook_id=nb.id, notebook_version=nb.version, title=nb.title, cells=cells,
                           author_id=_uuid(author_id), reason=reason, created_at=now, updated_at=now))
    await db.flush()
    keep = select(NotebookVersion.id).where(NotebookVersion.notebook_id == nb.id) \
        .order_by(NotebookVersion.updated_at.desc()).limit(MAX_HISTORY)
    await db.execute(delete(NotebookVersion).where(NotebookVersion.notebook_id == nb.id,
                                                   NotebookVersion.id.not_in(keep)))


@router.get("")
async def list_notebooks(
    project_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Notebooks in the current project: your own, plus the ones shared with the project. Like
    dashboards, a notebook belongs to one project and only shows there."""
    caller = caller_from_token(current_token, project_id)
    await require_permission(caller.user_id, "query:execute", organization_id=caller.organization_id, project_id=caller.project_id)
    me = _uuid(caller.user_id)
    org = _uuid(caller.organization_id)
    proj = _uuid(caller.project_id)
    conds = [
        Notebook.is_deleted.is_not(True),
        Notebook.organization_id == org if org else Notebook.organization_id.is_(None),
        Notebook.project_id == proj if proj else Notebook.project_id.is_(None),
        or_(Notebook.user_id == me, Notebook.visibility == "project"),
    ]
    if q and q.strip():
        conds.append(Notebook.title.ilike(f"%{q.strip()}%"))
    stmt = select(Notebook).where(and_(*conds)).order_by(Notebook.updated_at.desc()).limit(500)
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_serialize(nb, caller, with_cells=False) for nb in rows]}


@router.post("", status_code=201)
async def create_notebook(
    body: NotebookCreate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token, body.project_id)
    await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id, project_id=caller.project_id)
    nb = Notebook(
        title=body.title.strip(),
        description=body.description,
        cells=_cells_json(body.cells),
        user_id=_uuid(caller.user_id),
        organization_id=_uuid(caller.organization_id),
        project_id=_uuid(caller.project_id),
    )
    db.add(nb)
    await db.commit()
    await db.refresh(nb)
    # The starting point (new, imported or copied) stays in the history on its own.
    await _snapshot(db, nb, caller.user_id, reason="created")
    await db.commit()
    return _serialize(nb, caller)


@router.post("/import", status_code=201)
async def import_notebook(
    body: NotebookImport,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Create a notebook from a Jupyter .ipynb document."""
    try:
        raw_cells = ipynb.from_ipynb(body.notebook)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    cells: List[Cell] = []
    for raw in raw_cells:
        try:
            cells.append(Cell(**raw))
        except Exception:
            raw.pop("name", None)  # a Jupyter variable name that isn't a valid result name
            cells.append(Cell(**raw))
    title = body.title or str((body.notebook.get("metadata") or {}).get("title") or "Imported notebook")
    return await create_notebook(
        NotebookCreate(title=title[:200], cells=cells, project_id=body.project_id), current_token, db
    )


@router.get("/{notebook_id}")
async def get_notebook(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    return _serialize(await _load(db, notebook_id, caller, write=False), caller)


@router.put("/{notebook_id}")
async def update_notebook(
    notebook_id: str,
    body: NotebookUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Save changes. ``version`` must match the stored one, so two tabs can't silently
    overwrite each other: the second gets a 409 and reloads."""
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    if body.version != nb.version:
        raise HTTPException(status_code=409, detail="This notebook changed somewhere else. Reload to see the latest version.")
    if body.title is not None:
        nb.title = body.title.strip()
    if body.description is not None:
        nb.description = body.description
    if body.cells is not None:
        nb.cells = _cells_json(body.cells)
    if body.visibility is not None:
        nb.visibility = body.visibility
    nb.version = nb.version + 1
    nb.updated_at = datetime.now(timezone.utc)
    await _snapshot(db, nb, caller.user_id)
    await db.commit()
    await db.refresh(nb)
    return _serialize(nb, caller)


@router.get("/{notebook_id}/versions")
async def list_versions(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """The notebook's history, newest first (anyone who can open it can see how it got here)."""
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    rows = (await db.execute(
        select(NotebookVersion).where(NotebookVersion.notebook_id == nb.id).order_by(NotebookVersion.updated_at.desc())
    )).scalars().all()
    return {"items": [{
        "id": str(v.id), "title": v.title, "reason": v.reason, "notebook_version": v.notebook_version,
        "cell_count": len(v.cells or []), "author_id": str(v.author_id), "is_me": str(v.author_id) == caller.user_id,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    } for v in rows]}


async def _version(db: AsyncSession, nb: Notebook, version_id: str) -> NotebookVersion:
    v = await db.get(NotebookVersion, _uuid(version_id))
    if not v or v.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Version not found")
    return v


@router.get("/{notebook_id}/versions/{version_id}")
async def get_version(
    notebook_id: str,
    version_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    v = await _version(db, nb, version_id)
    return {"id": str(v.id), "title": v.title, "cells": v.cells or [], "reason": v.reason,
            "updated_at": v.updated_at.isoformat() if v.updated_at else None}


@router.post("/{notebook_id}/versions/{version_id}/restore")
async def restore_version(
    notebook_id: str,
    version_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Put the notebook back to a saved point. The current state is recorded first, so a
    restore can itself be undone from the history. Outputs are not kept in history: run the
    notebook to refresh them."""
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    v = await _version(db, nb, version_id)
    await _snapshot(db, nb, caller.user_id, reason="before_restore")
    nb.cells = [dict(c) for c in (v.cells or [])]
    nb.title = v.title
    nb.version = nb.version + 1
    nb.updated_at = datetime.now(timezone.utc)
    await _snapshot(db, nb, caller.user_id, reason="restore")
    await db.commit()
    await db.refresh(nb)
    return _serialize(nb, caller)


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    nb.is_deleted = True
    nb.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{notebook_id}/restore")
async def restore_notebook(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Undo a delete (the list offers Undo rather than asking to confirm)."""
    caller = caller_from_token(current_token)
    nb = await db.get(Notebook, _uuid(notebook_id))
    if not nb or str(nb.user_id) != caller.user_id:
        raise HTTPException(status_code=404, detail="Notebook not found")
    nb.is_deleted = False
    nb.deleted_at = None
    await db.commit()
    await db.refresh(nb)
    return _serialize(nb, caller, with_cells=False)


@router.post("/{notebook_id}/duplicate", status_code=201)
async def duplicate_notebook(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    src = await _load(db, notebook_id, caller, write=False)
    cells = [Cell(**{k: v for k, v in c.items() if k != "output"}) for c in (src.cells or [])]
    return await create_notebook(
        NotebookCreate(
            title=f"{src.title} (copy)"[:200], description=src.description, cells=cells,
            project_id=str(src.project_id) if src.project_id else None,
        ),
        current_token, db,
    )


@router.get("/{notebook_id}/export")
async def export_notebook(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """The notebook as a Jupyter .ipynb document (without outputs)."""
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    return ipynb.to_ipynb(nb.title, nb.cells or [])


@router.post("/save-dataset")
async def save_result_as_dataset(
    body: SaveDatasetRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    """Keep a cell's result (for example a cleaned table from Python) as a dataset. It is data
    the person already has in their browser, stored through the same checks as an upload."""
    import pyarrow as pa

    from src.modules.data.services.dataset_writer import save_table_as_dataset

    width = len(body.columns)
    if any(len(r) != width for r in body.rows):
        raise HTTPException(status_code=400, detail="Every row needs one value per column.")
    columns = {}
    for i, name in enumerate(body.columns):
        values = [r[i] for r in body.rows]
        try:
            columns[name] = pa.array(values)
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            columns[name] = pa.array([None if v is None else str(v) for v in values])
    return await save_table_as_dataset(current_token, body.name, pa.table(columns), project_id=body.project_id)


# ── Comments: threads on the notebook or a cell (anyone who can open it) ───────

@router.get("/{notebook_id}/comments")
async def list_comments(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    nb = await _load(db, notebook_id, caller_from_token(current_token), write=False)
    return {"threads": await comments.list_threads(db, nb)}


@router.post("/{notebook_id}/comments", status_code=201)
@rate_limit(requests_per_minute=30, bucket="notebook_comments")
async def create_comment(
    notebook_id: str,
    payload: CommentCreate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    return await comments.create(db, nb, caller.user_id, payload.body, cell_id=payload.widget_id,
                                 parent_id=str(payload.parent_id) if payload.parent_id else None)


@router.patch("/{notebook_id}/comments/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="notebook_comments")
async def update_comment(
    notebook_id: str,
    comment_id: str,
    payload: CommentUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    if payload.body is None and payload.resolved is None:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    out: Dict[str, Any] = {}
    if payload.body is not None:
        out = await comments.edit(db, nb, comment_id, caller.user_id, payload.body)
    if payload.resolved is not None:
        out = await comments.set_resolved(db, nb, comment_id, caller.user_id, payload.resolved)
    return out


@router.delete("/{notebook_id}/comments/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="notebook_comments")
async def delete_comment(
    notebook_id: str,
    comment_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    return await comments.delete(db, nb, comment_id, caller.user_id)
