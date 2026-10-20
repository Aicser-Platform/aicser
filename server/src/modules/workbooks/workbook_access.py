"""Workbook load / id helpers shared by routers (avoids circular imports)."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller
from src.modules.workbooks.models import Workbook


def workbook_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


async def can_read_project_workbook(caller: Caller, project_id: Optional[uuid.UUID]) -> bool:
    try:
        await require_permission(
            caller.user_id,
            "query:execute",
            organization_id=caller.organization_id,
            project_id=str(project_id) if project_id else None,
        )
        return True
    except HTTPException:
        return False


async def load_workbook(
    db: AsyncSession,
    workbook_id: str,
    caller: Caller,
    *,
    write: bool,
) -> Workbook:
    wb = await db.get(Workbook, workbook_uuid(workbook_id))
    if not wb or wb.is_deleted:
        raise HTTPException(status_code=404, detail="Workbook not found")
    if str(wb.user_id) == caller.user_id:
        return wb
    shared = wb.visibility == "project" and (
        (wb.organization_id and caller.organization_id and str(wb.organization_id) == caller.organization_id)
        or (not wb.organization_id and not caller.organization_id)
    )
    if not shared or not await can_read_project_workbook(caller, wb.project_id):
        raise HTTPException(status_code=404, detail="Workbook not found")
    if write:
        raise HTTPException(status_code=403, detail="Only the owner can change this workbook. Make a copy to edit it.")
    return wb
