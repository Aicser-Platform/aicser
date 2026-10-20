"""GET /api/impact/{kind}/{id}: what a change to this object would affect."""

from __future__ import annotations

import dataclasses
import uuid
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.data.services.data_source_access_service import DataSourceAccessService
from src.modules.data.services.governed_sql import Caller, caller_from_token
from src.modules.impact import service

router = APIRouter()

# Kinds whose ids are UUIDs (connections and metrics use their own string ids).
_UUID_KINDS = {"chart", "dashboard", "recipe", "model", "decision"}

# The object itself must be visible to the caller; its organization scopes every dependent.
_TARGET = {
    "chart": ("SELECT c.project_id, p.organization_id, c.user_id FROM charts c JOIN projects p ON p.id = c.project_id "
              "WHERE c.id = CAST(:ref AS uuid) AND c.is_deleted IS NOT TRUE", "chart:view"),
    "dashboard": ("SELECT d.project_id, p.organization_id, d.created_by FROM dashboards d JOIN projects p ON p.id = d.project_id "
                  "WHERE d.id = CAST(:ref AS uuid) AND d.is_deleted IS NOT TRUE", "dashboard:view"),
    "metric": ("SELECT m.project_id, p.organization_id, NULL, m.data_source_id FROM semantic_metrics m JOIN projects p ON p.id = m.project_id "
               "WHERE m.id = :ref", "semantic:view"),
    "model": ("SELECT project_id, organization_id, created_by FROM ml_models "
              "WHERE id = CAST(:ref AS uuid) AND is_deleted IS NOT TRUE", "query:execute"),
    "decision": ("SELECT project_id, organization_id, created_by FROM ai_decision_definitions "
                 "WHERE id = CAST(:ref AS uuid) AND is_active IS TRUE", "query:execute"),
    "recipe": ("SELECT r.project_id, COALESCE(r.organization_id, p.organization_id), r.user_id FROM prep_recipes r "
               "LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = CAST(:ref AS uuid) AND r.is_deleted IS NOT TRUE", "data:view"),
}


async def _target_org(db: AsyncSession, caller: Caller, kind: str, ref: str) -> str:
    """The organization the object belongs to, once the caller is allowed to see it."""
    if kind == "data_source":
        ids = await DataSourceAccessService.list_accessible_source_ids(
            caller.user_id, caller.organization_id, project_id=caller.project_id, session=db,
        )
        if ref not in {str(i) for i in ids}:
            raise HTTPException(status_code=404, detail="Not found.")
        rows = await service._rows(db, "SELECT organization_id FROM data_sources WHERE id = :ref", {"ref": ref})
        org = str(rows[0][0]) if rows and rows[0][0] else None
    else:
        sql, permission = _TARGET[kind]
        rows = await service._rows(db, sql, {"ref": ref})
        if not rows:
            raise HTTPException(status_code=404, detail="Not found.")
        project_id = str(rows[0][0]) if rows[0][0] else None
        org = str(rows[0][1]) if rows[0][1] else None
        owner = str(rows[0][2]) if rows[0][2] else None
        if not org:
            raise HTTPException(status_code=404, detail="Not found.")
        allowed = await service.visible(dataclasses.replace(caller, organization_id=org), permission, project_id, owner)
        if not allowed and kind == "metric" and not service.is_ee_enabled():
            # Community: a metric is as visible as the connection it is defined on.
            ids = await DataSourceAccessService.list_accessible_source_ids(
                caller.user_id, caller.organization_id, project_id=caller.project_id, session=db,
            )
            allowed = str(rows[0][3]) in {str(i) for i in ids}
        if not allowed:
            raise HTTPException(status_code=404, detail="Not found.")
    if not org:
        raise HTTPException(status_code=404, detail="Not found.")
    return org


@router.get("/{kind}/{ref}")
async def impact(
    kind: str,
    ref: str,
    project_id: Optional[str] = Query(default=None),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    if kind not in service.KINDS:
        raise HTTPException(status_code=404, detail="Not found.")
    if kind in _UUID_KINDS:
        try:
            ref = str(uuid.UUID(ref))
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found.") from None
    caller = caller_from_token(current_token, project_id)
    org = await _target_org(db, caller, kind, ref)
    return (await service.dependents(db, dataclasses.replace(caller, organization_id=org), kind, ref)).as_dict()
