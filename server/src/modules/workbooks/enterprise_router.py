"""Workbook governance API (parameters, certification, audit, secrets on range SQL)."""
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
import base64
from datetime import datetime, timezone

from src.modules.workbooks.governance import approve_workbook, reject_workbook, submit_for_review, update_settings
from src.modules.notebooks.secrets_lint import lint_cells
from src.modules.notebooks.settings_schema import parse_settings
from src.modules.workbooks.audit import list_workbook_audit, log_workbook_event
from src.modules.workbooks.workbook_access import load_workbook as _load, workbook_uuid as _uuid

router = APIRouter()


class SettingsPatch(BaseModel):
    parameters: Optional[List[dict]] = None
    compute_profile: Optional[str] = None
    git: Optional[dict] = None
    certification: Optional[dict] = None
    visual_embeds: Optional[List[dict]] = None
    analyze_bindings: Optional[List[dict]] = None


class CertifyBody(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)
    lock_edits: bool = True


@router.get("/{workbook_id}/settings")
async def get_settings(workbook_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    return {"settings": parse_settings(getattr(wb, "settings", None)).model_dump()}


@router.put("/{workbook_id}/settings")
async def put_settings(workbook_id: str, body: SettingsPatch, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    settings = await update_settings(db, wb, body.model_dump(exclude_none=True), _uuid(caller.user_id) or uuid.uuid4())
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{workbook_id}/lint-secrets")
async def lint_secrets(workbook_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    cells = [{"id": r.get("id"), "source": r.get("sql", "")} for r in (wb.ranges or []) if isinstance(r, dict)]
    findings = lint_cells(cells)
    return {"findings": findings, "ok": not findings}


@router.get("/{workbook_id}/audit")
async def get_audit(workbook_id: str, limit: int = Query(200, ge=1, le=500), current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    return {"items": await list_workbook_audit(db, wb.id, limit=limit)}


@router.get("/{workbook_id}/audit/export")
async def export_audit_csv(workbook_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    items = await list_workbook_audit(db, wb.id, limit=500)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "action", "user_id", "metadata"])
    for row in items:
        w.writerow([row.get("created_at"), row.get("action"), row.get("user_id"), row.get("metadata")])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="workbook-{workbook_id}-audit.csv"'})


@router.post("/{workbook_id}/certification/submit")
async def certification_submit(workbook_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    settings = await submit_for_review(db, wb, _uuid(caller.user_id) or uuid.uuid4())
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{workbook_id}/certification/approve")
async def certification_approve(workbook_id: str, body: CertifyBody, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    settings = await approve_workbook(db, wb, _uuid(caller.user_id) or uuid.uuid4(), body.note, body.lock_edits)
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{workbook_id}/certification/reject")
async def certification_reject(workbook_id: str, body: CertifyBody, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    settings = await reject_workbook(db, wb, _uuid(caller.user_id) or uuid.uuid4(), body.note)
    await db.commit()
    return {"settings": settings.model_dump()}


@router.post("/{workbook_id}/git/export")
async def git_export(workbook_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    settings = parse_settings(getattr(wb, "settings", None))
    manifest = {
        "workbook_id": str(wb.id),
        "title": wb.title,
        "version": wb.version,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git": settings.git.model_dump(),
        "suggested_path": f"sheets/{wb.title.replace(' ', '_')[:80]}.xlsx",
    }
    settings.git.last_export_at = manifest["exported_at"]
    wb.settings = settings.model_dump()
    await log_workbook_event(db, workbook_id=wb.id, user_id=_uuid(caller.user_id), action="git_export")
    await db.commit()
    return {"manifest": manifest, "doc_b64": base64.b64encode(bytes(wb.doc)).decode("ascii"), "ranges": wb.ranges or []}
