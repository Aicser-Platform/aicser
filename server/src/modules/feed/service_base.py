"""Feed service base helpers."""
from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import NAMESPACE_DNS, UUID, uuid5

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.authentication.rbac.models import UserRole
from src.modules.feed.models import FeedAuthorFollow, FeedCollection, FeedComment as FeedCommentModel, FeedCommentReaction, FeedEvent, FeedInteraction, FeedNotification, FeedPost, FeedShare, FeedView
from src.modules.user.models import User
from src.modules.feed.service_utils import _safe_uuid


class FeedServiceBaseMixin:
    db: AsyncSession

    async def _repoint_user_references(self, from_user_id: UUID, to_user_id: UUID) -> None:
        """Move FK-like user references from a legacy user PK to the auth PK."""
        if from_user_id == to_user_id:
            return

        await self.db.execute(update(FeedPost).where(FeedPost.author_id == from_user_id).values(author_id=to_user_id))
        await self.db.execute(update(FeedPost).where(FeedPost.approved_by == from_user_id).values(approved_by=to_user_id))
        await self.db.execute(update(FeedPost).where(FeedPost.rejected_by == from_user_id).values(rejected_by=to_user_id))

        await self.db.execute(update(FeedCommentModel).where(FeedCommentModel.user_id == from_user_id).values(user_id=to_user_id))
        await self.db.execute(update(FeedCommentModel).where(FeedCommentModel.deleted_by == from_user_id).values(deleted_by=to_user_id))
        await self.db.execute(
            update(FeedCommentReaction).where(FeedCommentReaction.user_id == from_user_id).values(user_id=to_user_id)
        )
        await self.db.execute(update(FeedInteraction).where(FeedInteraction.user_id == from_user_id).values(user_id=to_user_id))
        await self.db.execute(update(FeedEvent).where(FeedEvent.actor_id == from_user_id).values(actor_id=to_user_id))
        await self.db.execute(
            update(FeedEvent).where(FeedEvent.target_user_id == from_user_id).values(target_user_id=to_user_id)
        )
        await self.db.execute(update(FeedView).where(FeedView.user_id == from_user_id).values(user_id=to_user_id))
        await self.db.execute(update(FeedCollection).where(FeedCollection.owner_id == from_user_id).values(owner_id=to_user_id))
        await self.db.execute(
            update(FeedNotification).where(FeedNotification.recipient_id == from_user_id).values(recipient_id=to_user_id)
        )
        await self.db.execute(update(FeedNotification).where(FeedNotification.actor_id == from_user_id).values(actor_id=to_user_id))
        await self.db.execute(update(FeedShare).where(FeedShare.user_id == from_user_id).values(user_id=to_user_id))
        await self.db.execute(update(FeedAuthorFollow).where(FeedAuthorFollow.follower_id == from_user_id).values(follower_id=to_user_id))
        await self.db.execute(update(FeedAuthorFollow).where(FeedAuthorFollow.following_id == from_user_id).values(following_id=to_user_id))

        # UserRole.user_id is not FK-constrained but should stay aligned for permission checks.
        await self.db.execute(update(UserRole).where(UserRole.user_id == from_user_id).values(user_id=to_user_id))

    @staticmethod
    def resolve_user_id(user_payload: Optional[Dict[str, Any]]) -> Optional[UUID]:
        if not isinstance(user_payload, dict):
            return None
        raw = user_payload.get("id") or user_payload.get("user_id") or user_payload.get("sub")
        if raw in (None, "", "0", 0):
            return None

        parsed = _safe_uuid(raw)
        if parsed:
            return parsed

        # Some dev/auth environments provide non-UUID IDs.
        # Generate a stable UUID so interactions can still be persisted.
        try:
            return uuid5(NAMESPACE_DNS, f"feed-user:{str(raw).strip().lower()}")
        except Exception:
            return None

    async def _ensure_user_row(
        self,
        user_id: Optional[UUID],
        payload: Optional[Dict[str, Any]] = None,
    ) -> Optional[User]:
        if not user_id:
            return None

        user = await self.db.scalar(select(User).where(User.id == user_id))
        if user:
            return user

        # Legacy rows may have auth UUID in users.user_id but a different PK in users.id.
        # Reconcile them so feed FK/policy logic can consistently use auth UUID as users.id.
        user_by_auth = await self.db.scalar(select(User).where(User.user_id == user_id))
        if user_by_auth:
            legacy_id = user_by_auth.id
            if legacy_id != user_id:
                existing_target = await self.db.scalar(select(User).where(User.id == user_id))
                await self._repoint_user_references(legacy_id, user_id)
                if existing_target:
                    if not existing_target.first_name and user_by_auth.first_name:
                        existing_target.first_name = user_by_auth.first_name
                    if not existing_target.last_name and user_by_auth.last_name:
                        existing_target.last_name = user_by_auth.last_name
                    if not existing_target.company and user_by_auth.company:
                        existing_target.company = user_by_auth.company
                    await self.db.delete(user_by_auth)
                    await self.db.flush()
                    return existing_target

                await self.db.execute(
                    update(User).where(User.id == legacy_id).values(id=user_id)
                )
                await self.db.flush()
                user_by_auth = await self.db.scalar(select(User).where(User.id == user_id))

            return user_by_auth

        payload = payload or {}
        full_name = str(payload.get("name") or payload.get("full_name") or "").strip()
        first_name = str(payload.get("first_name") or "").strip() or None
        last_name = str(payload.get("last_name") or "").strip() or None

        if full_name and not first_name:
            parts = full_name.split(" ", 1)
            first_name = parts[0]
            last_name = parts[1] if len(parts) > 1 else None

        user = User(
            id=user_id,
            user_id=user_id,
            first_name=first_name,
            last_name=last_name,
            company=payload.get("company") or payload.get("title"),
        )
        self.db.add(user)
        await self.db.flush()
        return user

    async def _set_rls_context(self, user_id: Optional[UUID]) -> None:
        """Set per-request RLS context for Postgres policies."""
        if user_id:
            await self.db.execute(
                text("SELECT set_config('app.user_id', :user_id, true)"),
                {"user_id": str(user_id)},
            )
        else:
            await self.db.execute(text("SELECT set_config('app.user_id', '', true)"))
