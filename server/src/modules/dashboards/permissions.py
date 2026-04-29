from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedPost


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
    Enforce that only the publishing owner (feed post author) can edit
    a dashboard once it has been published to the feed.

    If no feed post exists for the dashboard, editing is allowed.
    """
    user_id = _resolve_user_id(user_payload)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    result = await db.execute(
        select(FeedPost.author_id).where(
            FeedPost.asset_type == "dashboard",
            FeedPost.asset_id == dashboard_id,
        )
    )
    row = result.first()
    if not row:
        return

    author_id = row[0]
    if not author_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Publish owner not recorded for this dashboard",
        )

    if str(author_id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the publishing owner can edit this dashboard",
        )
