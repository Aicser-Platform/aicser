"""Notebook-specific audit trail (runs, certification, exports) for enterprise teams."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notebooks.models import NotebookAuditEvent


async def log_notebook_event(
    db: AsyncSession,
    *,
    notebook_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    action: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    row = NotebookAuditEvent(
        id=uuid.uuid4(),
        notebook_id=notebook_id,
        user_id=user_id,
        action=action,
        event_metadata=metadata or {},
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.flush()


async def list_notebook_audit(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    limit: int = 200,
) -> list[dict]:
    stmt = (
        select(NotebookAuditEvent)
        .where(NotebookAuditEvent.notebook_id == notebook_id)
        .order_by(NotebookAuditEvent.created_at.desc())
        .limit(min(limit, 500))
    )
    res = await db.execute(stmt)
    rows = res.scalars().all()
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "user_id": str(r.user_id) if r.user_id else None,
            "metadata": r.event_metadata or {},
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
