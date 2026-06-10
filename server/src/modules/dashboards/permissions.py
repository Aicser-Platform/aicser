from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


def _resolve_user_id(user_payload: Any) -> Optional[str]:
    if isinstance(user_payload, dict):
        for key in ("id", "user_id", "sub"):
            value = user_payload.get(key)
            if value:
                return str(value)
    if isinstance(user_payload, str):
        return user_payload
    return None


async def enforce_publish_owner_edit(
    db: AsyncSession,
    dashboard_id: UUID,
    user_payload: Dict[str, Any] | Any,
) -> None:
    """
    Snapshot publication model: live dashboard studio edits are always allowed.
    Feed posts show immutable snapshots; only snapshot updates are owner-gated
    (see feed.permissions.enforce_snapshot_update_owner).
    """
    return
