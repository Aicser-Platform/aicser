from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


async def enforce_publish_owner_chart_edit(
    db: AsyncSession,
    chart_id: UUID,
    user_payload: Dict[str, Any] | Any,
) -> None:
    """Snapshot model: live chart edits are unrestricted; feed shows frozen snapshots."""
    return
