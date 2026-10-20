"""Enterprise notebook APIs: parameters, lint, audit, certification, git export."""
from __future__ import annotations

import csv
import io
import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.data.services.governed_sql import caller_from_token
from src.modules.notebooks.audit import list_notebook_audit, log_notebook_event
from src.modules.notebooks.enterprise import (
    approve_notebook,
    git_export_bundle,
    reject_notebook,
    settings_locked,
    submit_for_review,
    update_settings,
)
from src.modules.notebooks.parameters import apply_parameters_raw, resolve_parameters
from src.modules.notebooks.notebook_access import load_notebook as _load, notebook_uuid as _uuid
from src.modules.notebooks.secrets_lint import lint_cells
from src.modules.notebooks.settings_schema import NotebookSettings, parse_settings

router = APIRouter()


class SettingsPatch(BaseModel):
    parameters: Optional[List[dict]] = None
    compute_profile: Optional[str] = None
    git: Optional[dict] = None
    certification: Optional[dict] = None


class CertifyBody(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)
    lock_edits: bool = True


class ApplyParamsBody(BaseModel):
    values: Dict[str, Any] = Field(default_factory=dict)


@router.get("/{notebook_id}/settings")
async def get_settings(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    return {"settings": parse_settings(nb.settings).model_dump()}


@router.put("/{notebook_id}/settings")
async def put_settings(
    notebook_id: str,
    body: SettingsPatch,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    patch = body.model_dump(exclude_none=True)
    settings = await update_settings(db, nb, patch, _uuid(caller.user_id) or uuid.uuid4())
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{notebook_id}/parameters/apply")
async def preview_parameters(
    notebook_id: str,
    body: ApplyParamsBody,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    settings = parse_settings(nb.settings)
    try:
        values = resolve_parameters(settings, body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    cells = apply_parameters_raw(nb.cells or [], nb.settings, body.values)
    return {"values": values, "cells": cells}


@router.post("/{notebook_id}/lint-secrets")
async def lint_secrets(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    findings = lint_cells(nb.cells or [])
    return {"findings": findings, "ok": not findings}


@router.get("/{notebook_id}/audit")
async def get_audit(
    notebook_id: str,
    limit: int = Query(200, ge=1, le=500),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    items = await list_notebook_audit(db, nb.id, limit=limit)
    return {"items": items}


@router.get("/{notebook_id}/audit/export")
async def export_audit_csv(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=False)
    items = await list_notebook_audit(db, nb.id, limit=500)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "action", "user_id", "metadata"])
    for row in items:
        w.writerow([row.get("created_at"), row.get("action"), row.get("user_id"), row.get("metadata")])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="notebook-{notebook_id}-audit.csv"'},
    )


@router.post("/{notebook_id}/certification/submit")
async def certification_submit(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    settings = await submit_for_review(db, nb, _uuid(caller.user_id) or uuid.uuid4())
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{notebook_id}/certification/approve")
async def certification_approve(
    notebook_id: str,
    body: CertifyBody,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    settings = await approve_notebook(db, nb, _uuid(caller.user_id) or uuid.uuid4(), body.note, body.lock_edits)
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{notebook_id}/certification/reject")
async def certification_reject(
    notebook_id: str,
    body: CertifyBody,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    settings = await reject_notebook(db, nb, _uuid(caller.user_id) or uuid.uuid4(), body.note)
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{notebook_id}/git/export")
async def git_export(
    notebook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    nb = await _load(db, notebook_id, caller, write=True)
    bundle = git_export_bundle(nb)
    await log_notebook_event(db, notebook_id=nb.id, user_id=_uuid(caller.user_id), action="git_export")
    await db.commit()
    return bundle
