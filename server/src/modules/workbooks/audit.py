from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.workbooks.models import WorkbookAuditEvent


async def log_workbook_event(
    db: AsyncSession,
    *,
    workbook_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    action: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    db.add(
        WorkbookAuditEvent(
            id=uuid.uuid4(),
            workbook_id=workbook_id,
            user_id=user_id,
            action=action,
            event_metadata=metadata or {},
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def list_workbook_audit(db: AsyncSession, workbook_id: uuid.UUID, limit: int = 200) -> list[dict]:
    stmt = (
        select(WorkbookAuditEvent)
        .where(WorkbookAuditEvent.workbook_id == workbook_id)
        .order_by(WorkbookAuditEvent.created_at.desc())
        .limit(min(limit, 500))
    )
    res = await db.execute(stmt)
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "user_id": str(r.user_id) if r.user_id else None,
            "metadata": r.event_metadata or {},
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in res.scalars().all()
    ]
