"""Feed publication snapshot ownership (live studio edits are unrestricted)."""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.dashboards.permissions import _resolve_user_id
from src.modules.feed.models import FeedPost


async def enforce_snapshot_update_owner(
    db: AsyncSession,
    post_id: UUID,
    user_payload: Any,
) -> FeedPost:
    """Only the feed post author may update publication snapshots."""
    user_id = _resolve_user_id(user_payload)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    post = await db.scalar(select(FeedPost).where(FeedPost.id == post_id))
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publication not found")
    if not post.author_id or str(post.author_id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the publication owner can update this snapshot",
        )
    return post
