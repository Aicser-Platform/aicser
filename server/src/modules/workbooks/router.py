"""Aicser Sheet API. The workbook document is IronCalc's binary format, edited in the viewer's
browser (the engine runs there as WebAssembly) and stored here. Live data ranges are filled by
the browser through the query endpoint, so row security always applies to the viewer; this
module stores documents, keeps their history and comments, and imports/exports .xlsx."""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.dashboards.comments_router import CommentCreate, CommentUpdate
from src.modules.data.services.governed_sql import Caller, caller_from_token
from src.modules.workbooks import engine
from src.modules.workbooks.models import Workbook, WorkbookComment, WorkbookVersion
from src.modules.workbooks.schemas import WorkbookCreate, WorkbookUpdate
from src.modules.notebooks.settings_schema import parse_settings
from src.modules.workbooks.governance import settings_locked
from src.modules.workbooks.audit import log_workbook_event
from src.modules.workbooks.workbook_access import load_workbook, workbook_uuid
from src.modules.workbooks.enterprise_router import router as workbook_enterprise_router
from src.shared.comment_threads import CommentThreads
from src.shared.middleware.rate_limiter import rate_limit

logger = logging.getLogger(__name__)
router = APIRouter()
router.include_router(workbook_enterprise_router)
comments = CommentThreads(WorkbookComment, "workbook_id", "cell_ref", anchor_max=80)

_load = load_workbook
_uuid = workbook_uuid

# History: one point per person per working session; documents can be large, so fewer kept
# than for notebooks.
SESSION_GAP = timedelta(minutes=10)
MAX_HISTORY = 50


def _bad(exc: engine.WorkbookError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _serialize(wb: Workbook, caller: Caller, *, with_doc: bool = True) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": str(wb.id),
        "title": wb.title,
        "description": wb.description,
        "visibility": wb.visibility,
        "version": wb.version,
        "project_id": str(wb.project_id) if wb.project_id else None,
        "folder_id": str(wb.folder_id) if wb.folder_id else None,
        "is_owner": str(wb.user_id) == caller.user_id,
        "size": wb.doc_size,
        "range_count": len(wb.ranges or []),
        "locale": wb.locale,
        "timezone": wb.timezone,
        "created_at": wb.created_at.isoformat() if wb.created_at else None,
        "updated_at": wb.updated_at.isoformat() if wb.updated_at else None,
        "settings": parse_settings(getattr(wb, "settings", None)).model_dump(),
    }
    if with_doc:
        out["doc"] = base64.b64encode(bytes(wb.doc)).decode("ascii")
        out["ranges"] = wb.ranges or []
    return out


def _decode(doc_b64: str) -> bytes:
    try:
        return base64.b64decode(doc_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The workbook data is damaged.") from exc


async def _snapshot(db: AsyncSession, wb: Workbook, author_id: str, reason: str = "save") -> None:
    """Record the workbook as it now is (same rules as notebook history)."""
    now = datetime.now(timezone.utc)
    last = (await db.execute(
        select(WorkbookVersion).where(WorkbookVersion.workbook_id == wb.id)
        .order_by(WorkbookVersion.updated_at.desc()).limit(1)
    )).scalar_one_or_none()
    doc = bytes(wb.doc)
    if last and bytes(last.doc) == doc and last.title == wb.title:
        return
    if (reason == "save" and last and last.reason == "save" and str(last.author_id) == str(author_id)
            and last.updated_at and now - last.updated_at < SESSION_GAP):
        last.doc, last.ranges, last.title, last.workbook_version, last.updated_at = doc, wb.ranges or [], wb.title, wb.version, now
        return
    db.add(WorkbookVersion(workbook_id=wb.id, workbook_version=wb.version, title=wb.title, doc=doc,
                           ranges=wb.ranges or [], author_id=_uuid(author_id), reason=reason,
                           created_at=now, updated_at=now))
    await db.flush()
    keep = select(WorkbookVersion.id).where(WorkbookVersion.workbook_id == wb.id) \
        .order_by(WorkbookVersion.updated_at.desc()).limit(MAX_HISTORY)
    await db.execute(delete(WorkbookVersion).where(WorkbookVersion.workbook_id == wb.id,
                                                   WorkbookVersion.id.not_in(keep)))


async def _create(db: AsyncSession, caller: Caller, title: str, doc: bytes, *, locale: str, tz: str,
                  ranges: List[Dict[str, Any]], reason: str = "created") -> Workbook:
    await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id, project_id=caller.project_id)
    wb = Workbook(title=title.strip()[:200], doc=doc, doc_size=len(doc), ranges=ranges, locale=locale, timezone=tz,
                  user_id=_uuid(caller.user_id), organization_id=_uuid(caller.organization_id),
                  project_id=_uuid(caller.project_id))
    db.add(wb)
    await db.commit()
    await db.refresh(wb)
    await _snapshot(db, wb, caller.user_id, reason=reason)
    await db.commit()
    return wb


@router.get("")
async def list_workbooks(
    project_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Sheets in the current project: your own, plus the ones shared with the project. Like
    dashboards, a sheet belongs to one project and only shows there."""
    caller = caller_from_token(current_token, project_id)
    await require_permission(caller.user_id, "query:execute", organization_id=caller.organization_id, project_id=caller.project_id)
    org, proj = _uuid(caller.organization_id), _uuid(caller.project_id)
    conds = [
        Workbook.is_deleted.is_not(True),
        Workbook.organization_id == org if org else Workbook.organization_id.is_(None),
        Workbook.project_id == proj if proj else Workbook.project_id.is_(None),
        or_(Workbook.user_id == _uuid(caller.user_id), Workbook.visibility == "project"),
    ]
    if q and q.strip():
        conds.append(Workbook.title.ilike(f"%{q.strip()}%"))
    rows = (await db.execute(
        select(Workbook).where(and_(*conds)).order_by(Workbook.updated_at.desc()).limit(500)
    )).scalars().all()
    return {"items": [_serialize(wb, caller, with_doc=False) for wb in rows]}


@router.post("", status_code=201)
async def create_workbook(
    body: WorkbookCreate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token, body.project_id)
    locale, tz = engine.locale_for(body.locale), engine.timezone_for(body.timezone)
    doc = await asyncio.to_thread(engine.new_doc, body.title, locale, tz)
    wb = await _create(db, caller, body.title, doc, locale=locale, tz=tz,
                       ranges=[r.model_dump() for r in body.ranges])
    return _serialize(wb, caller)


@router.post("/import", status_code=201)
async def import_workbook(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    project_id: Optional[str] = Form(None),
    locale: Optional[str] = Form(None),
    tz: Optional[str] = Form(None, alias="timezone"),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """A new workbook from an .xlsx file (formulas that reach outside the sheet become text)."""
    caller = caller_from_token(current_token, project_id)
    data = await file.read(engine.MAX_XLSX_BYTES + 1)
    loc, zone = engine.locale_for(locale), engine.timezone_for(tz)
    try:
        out = await asyncio.to_thread(engine.from_xlsx, data, loc, zone)
    except engine.WorkbookError as exc:
        raise _bad(exc) from exc
    name = (title or re.sub(r"\.xlsx$", "", file.filename or "", flags=re.I) or "Imported workbook").strip()
    wb = await _create(db, caller, name, out["doc"], locale=loc, tz=zone, ranges=[], reason="import")
    res = _serialize(wb, caller)
    res["neutralized"] = out["neutralized"]
    return res


@router.post("/dedupe-file-sources")
async def dedupe_workbook_file_sources(
    project_id: Optional[str] = Query(None),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Deactivate duplicate FILE data sources (same sheet name / same workbook) in a project."""
    caller = caller_from_token(current_token, project_id)
    pid = project_id or caller.project_id
    await require_permission(
        caller.user_id,
        "data:edit",
        organization_id=caller.organization_id,
        project_id=pid,
    )
    from src.modules.workbooks.datasource_link import dedupe_project_file_sources

    return await dedupe_project_file_sources(db, project_id=pid)


@router.get("/{workbook_id}")
async def get_workbook(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    return _serialize(await _load(db, workbook_id, caller, write=False), caller)


@router.put("/{workbook_id}")
async def update_workbook(
    workbook_id: str,
    body: WorkbookUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Save changes; ``version`` must match, so two tabs can't silently overwrite each other."""
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    if settings_locked(parse_settings(getattr(wb, "settings", None))):
        raise HTTPException(status_code=403, detail="This workbook is certified and locked for editing.")
    if body.version != wb.version:
        raise HTTPException(status_code=409, detail="This workbook changed somewhere else. Reload to see the latest version.")
    if body.doc is not None:
        doc = _decode(body.doc)
        try:
            await asyncio.to_thread(engine.summary, doc)
        except engine.WorkbookError as exc:
            raise _bad(exc) from exc
        wb.doc, wb.doc_size = doc, len(doc)
    if body.title is not None:
        wb.title = body.title.strip()
    if body.description is not None:
        wb.description = body.description
    if body.ranges is not None:
        wb.ranges = [r.model_dump() for r in body.ranges]
    if body.visibility is not None:
        wb.visibility = body.visibility
    wb.version += 1
    wb.updated_at = datetime.now(timezone.utc)
    await _snapshot(db, wb, caller.user_id)
    await log_workbook_event(db, workbook_id=wb.id, user_id=_uuid(caller.user_id), action="save", metadata={"version": wb.version})
    if body.ranges is not None:
        try:
            from src.modules.workbooks.lineage import sync_range_lineage

            await sync_range_lineage(db, wb=wb, user_id=_uuid(caller.user_id) or wb.user_id, ranges=wb.ranges or [])
        except Exception as lineage_err:
            logger.debug("Workbook range lineage skipped: %s", lineage_err)
    await db.commit()
    await db.refresh(wb)
    out = _serialize(wb, caller, with_doc=False)
    out["ranges"] = wb.ranges or []
    return out


@router.delete("/{workbook_id}", status_code=204)
async def delete_workbook(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    wb.is_deleted, wb.deleted_at = True, datetime.now(timezone.utc)
    await db.commit()


@router.post("/{workbook_id}/restore")
async def restore_workbook(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Undo a delete (the list offers Undo rather than asking to confirm)."""
    caller = caller_from_token(current_token)
    wb = await db.get(Workbook, _uuid(workbook_id))
    if not wb or str(wb.user_id) != caller.user_id:
        raise HTTPException(status_code=404, detail="Workbook not found")
    wb.is_deleted, wb.deleted_at = False, None
    await db.commit()
    await db.refresh(wb)
    return _serialize(wb, caller, with_doc=False)


@router.post("/{workbook_id}/duplicate", status_code=201)
async def duplicate_workbook(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    src = await _load(db, workbook_id, caller, write=False)
    if src.project_id and not caller.project_id:
        caller.project_id = str(src.project_id)
    wb = await _create(db, caller, f"{src.title} (copy)"[:200], bytes(src.doc), locale=src.locale, tz=src.timezone,
                       ranges=list(src.ranges or []))
    return _serialize(wb, caller, with_doc=False)


@router.get("/{workbook_id}/export.xlsx")
async def export_xlsx(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    try:
        data = await asyncio.to_thread(engine.to_xlsx, bytes(wb.doc))
    except engine.WorkbookError as exc:
        raise _bad(exc) from exc
    logger.info("workbook export user=%s workbook=%s bytes=%d", caller.user_id, wb.id, len(data))
    safe = re.sub(r"[^A-Za-z0-9 _.-]+", "", wb.title).strip() or "workbook"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.xlsx"'})


@router.post("/{workbook_id}/sync-datasource")
async def sync_workbook_datasource(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Expose this workbook as a queryable data source so Aicser AI Ask and dashboards can query it."""
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)

    try:
        data = await asyncio.to_thread(engine.to_xlsx, bytes(wb.doc))
    except engine.WorkbookError as exc:
        raise _bad(exc) from exc

    from src.modules.data.services.data_connectivity_service import DataConnectivityService
    from src.modules.workbooks.datasource_link import (
        resolve_workbook_data_source_id,
        workbook_upload_options,
    )

    service = DataConnectivityService()

    project_id = str(wb.project_id) if wb.project_id else caller.project_id
    existing_ds_id, deduped = await resolve_workbook_data_source_id(
        db, str(wb.id), project_id=project_id,
    )

    clean_name = re.sub(r"[^A-Za-z0-9 _.-]+", "", wb.title).strip() or "Workbook"
    upload_options = workbook_upload_options(
        str(wb.id),
        wb.title,
        project_id=project_id,
        organization_id=caller.organization_id,
        user_id=caller.user_id,
        existing_source_id=existing_ds_id,
    )

    upload_res = await service.upload_file(
        file_content=data,
        filename=f"{clean_name}.xlsx",
        options=upload_options,
    )

    if not upload_res.get("success"):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to expose workbook as data source: {upload_res.get('error', 'Unknown error')}",
        )

    uploaded = upload_res.get("data_source") if isinstance(upload_res.get("data_source"), dict) else {}
    ds_id = upload_res.get("data_source_id") or uploaded.get("id") or existing_ds_id

    # Update DataSource to tag workbook_id in connection_config
    if ds_id:
        try:
            ds = await db.get(DataSource, str(ds_id))
            if ds:
                cfg = dict(ds.connection_config or {})
                cfg["workbook_id"] = str(wb.id)
                cfg["source_type"] = "workbook"
                ds.connection_config = cfg
                await db.commit()
        except Exception as e:
            logger.warning("Failed to stamp connection_config with workbook_id: %s", e)

        try:
            from src.modules.platform.lineage_service import emit_lineage_event
            await emit_lineage_event(
                db,
                event_type="workbook_synced_to_datasource",
                project_id=str(wb.project_id) if wb.project_id else None,
                actor_user_id=caller.user_id,
                data_source_id=str(ds_id),
                payload={
                    "workbook_id": str(wb.id),
                    "workbook_title": wb.title,
                    "data_source_id": str(ds_id),
                },
            )
        except Exception as lineage_err:
            logger.debug("Lineage event emission skipped: %s", lineage_err)

        try:
            from src.core.edition import is_ee_enabled
            from src.modules.data.services.query_identity import QueryIdentity

            if is_ee_enabled() and caller.organization_id:
                from src.modules.ontology.service import ontology_service

                identity = QueryIdentity(
                    user_id=str(caller.user_id),
                    organization_id=str(caller.organization_id),
                    project_id=str(wb.project_id) if wb.project_id else caller.project_id,
                )
                wb_node = await ontology_service.upsert_node(
                    db,
                    identity=identity,
                    kind="Workbook",
                    ptr=str(wb.id),
                    ptr_type="workbook",
                    project_id=identity.project_id,
                    props={"name": wb.title, "data_source_id": str(ds_id)},
                )
                ds_node = await ontology_service.upsert_node(
                    db,
                    identity=identity,
                    kind="Dataset",
                    ptr=str(ds_id),
                    ptr_type="catalog",
                    props={"name": f"{wb.title} (Sheet)", "data_source_id": str(ds_id)},
                )
                await ontology_service.upsert_edge(
                    db,
                    identity=identity,
                    edge_type="QUERIES",
                    src_id=wb_node["id"],
                    dst_id=ds_node["id"],
                )
                await db.commit()
        except Exception as ont_err:
            logger.debug("Workbook ontology pointer skipped: %s", ont_err)

    return {
        "success": True,
        "data_source_id": ds_id,
        "name": upload_options.get("name") or f"{wb.title} (Sheet)",
        "reused": bool(existing_ds_id),
        "deduped_sources": deduped,
        "message": "Workbook is now queryable by Aicser AI Ask and Dashboards",
    }


# ── History ─────────────────────────────────────────────────────────────────

@router.get("/{workbook_id}/versions")
async def list_versions(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    rows = (await db.execute(
        select(WorkbookVersion.id, WorkbookVersion.title, WorkbookVersion.reason, WorkbookVersion.workbook_version,
               WorkbookVersion.author_id, WorkbookVersion.created_at, WorkbookVersion.updated_at, WorkbookVersion.doc)
        .where(WorkbookVersion.workbook_id == wb.id).order_by(WorkbookVersion.updated_at.desc())
    )).all()
    return {"items": [{
        "id": str(r.id), "title": r.title, "reason": r.reason, "workbook_version": r.workbook_version,
        "size": len(r.doc or b""), "is_me": str(r.author_id) == caller.user_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    } for r in rows]}


@router.get("/{workbook_id}/versions/{version_id}")
async def get_version(
    workbook_id: str,
    version_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """A saved point's document, to preview read-only."""
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    v = await db.get(WorkbookVersion, _uuid(version_id))
    if not v or v.workbook_id != wb.id:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"id": str(v.id), "title": v.title, "doc": base64.b64encode(bytes(v.doc)).decode("ascii"),
            "ranges": v.ranges or [], "updated_at": v.updated_at.isoformat() if v.updated_at else None}


@router.post("/{workbook_id}/versions/{version_id}/restore")
async def restore_version(
    workbook_id: str,
    version_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=True)
    v = await db.get(WorkbookVersion, _uuid(version_id))
    if not v or v.workbook_id != wb.id:
        raise HTTPException(status_code=404, detail="Version not found")
    await _snapshot(db, wb, caller.user_id, reason="before_restore")
    wb.doc, wb.doc_size, wb.ranges, wb.title = bytes(v.doc), len(v.doc), list(v.ranges or []), v.title
    wb.version += 1
    wb.updated_at = datetime.now(timezone.utc)
    await _snapshot(db, wb, caller.user_id, reason="restore")
    await db.commit()
    await db.refresh(wb)
    return _serialize(wb, caller)


# ── Comments: threads on the workbook or a cell ("Sheet1!B4") ────────────────

@router.get("/{workbook_id}/comments")
async def list_comments(
    workbook_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    wb = await _load(db, workbook_id, caller_from_token(current_token), write=False)
    return {"threads": await comments.list_threads(db, wb.id)}


@router.post("/{workbook_id}/comments", status_code=201)
@rate_limit(requests_per_minute=30, bucket="workbook_comments")
async def create_comment(
    workbook_id: str,
    payload: CommentCreate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    return await comments.create(db, wb.id, caller.user_id, payload.body, anchor=payload.widget_id,
                                 parent_id=str(payload.parent_id) if payload.parent_id else None)


@router.patch("/{workbook_id}/comments/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="workbook_comments")
async def update_comment(
    workbook_id: str,
    comment_id: str,
    payload: CommentUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    if payload.body is None and payload.resolved is None:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    out: Dict[str, Any] = {}
    if payload.body is not None:
        out = await comments.edit(db, wb.id, comment_id, caller.user_id, payload.body)
    if payload.resolved is not None:
        out = await comments.set_resolved(db, wb.id, comment_id, caller.user_id, payload.resolved)
    return out


@router.delete("/{workbook_id}/comments/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="workbook_comments")
async def delete_comment(
    workbook_id: str,
    comment_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    wb = await _load(db, workbook_id, caller, write=False)
    return await comments.delete(db, wb.id, wb.user_id, comment_id, caller.user_id)
