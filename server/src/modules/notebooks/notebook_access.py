"""Notebook load / id helpers shared by routers (avoids circular imports)."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller
from src.modules.notebooks.models import Notebook


def notebook_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


async def can_read_project_notebook(caller: Caller, project_id: Optional[uuid.UUID]) -> bool:
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


async def load_notebook(
    db: AsyncSession,
    notebook_id: str,
    caller: Caller,
    *,
    write: bool,
) -> Notebook:
    nb = await db.get(Notebook, notebook_uuid(notebook_id))
    if not nb or nb.is_deleted:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if str(nb.user_id) == caller.user_id:
        return nb
    shared = nb.visibility == "project" and (
        (nb.organization_id and caller.organization_id and str(nb.organization_id) == caller.organization_id)
        or (not nb.organization_id and not caller.organization_id)
    )
    if not shared or not await can_read_project_notebook(caller, nb.project_id):
        raise HTTPException(status_code=404, detail="Notebook not found")
    if write:
        raise HTTPException(status_code=403, detail="Only the owner can change this notebook. Make a copy to edit it.")
    return nb
