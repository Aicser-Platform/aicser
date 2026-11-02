"""Legal hold: while an organization has it on, nothing of theirs is permanently deleted."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import text

logger = logging.getLogger(__name__)


async def held(db: Any, project_id: Optional[Any]) -> bool:
    if not project_id:
        return False
    try:
        async with db.begin_nested():
            value = (await db.execute(text(
                "SELECT o.settings->'compliance'->>'legal_hold' FROM projects p JOIN organizations o ON o.id = p.organization_id "
                "WHERE p.id = CAST(:p AS uuid)"), {"p": str(project_id)})).scalar()
    except Exception as exc:  # noqa: BLE001 - Community has no organizations table
        logger.debug("Legal hold not checked: %s", exc)
        return False
    return str(value).lower() == "true"


async def refuse_if_held(db: Any, project_id: Optional[Any]) -> None:
    if await held(db, project_id):
        raise HTTPException(status_code=423, detail="Your organization has a legal hold on: items can go to trash but can't be deleted for good.")
