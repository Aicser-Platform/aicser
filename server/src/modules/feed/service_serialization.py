"""Feed service serialization helpers."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Sequence, Set
from uuid import NAMESPACE_DNS, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedAuthorFollow, FeedComment as FeedCommentModel, FeedCommentReaction, FeedInteraction, FeedPost
from src.modules.user.models import User
from src.modules.feed.schemas import (
    AssetType,
    FeedAuthor,
    FeedComment,
    FeedItemResponse,
    FeedMetrics,
    FeedUserInteraction,
    FeedVisibility,
    PublicationStatus,
    ReactionType,
)
from src.modules.feed.service_utils import _enum_value, _reaction_values, _to_iso


class FeedServiceSerializationMixin:
    db: AsyncSession

    def _preview_payload(self, post: FeedPost) -> Dict[str, Any]:
        asset_type = _enum_value(post.asset_type)
        preview_label_map = {
            AssetType.dashboard.value: "Live Dashboard",
            AssetType.chart.value: "Interactive Chart",
            AssetType.insight.value: "Insight Snapshot",
        }

        raw = int(str(post.asset_id).replace("-", "")[:12], 16)
        chart_types = ["bar", "line", "pie"]
        if asset_type == AssetType.dashboard.value:
            preview_type = "dashboard"
        elif asset_type == AssetType.insight.value:
            preview_type = "insight"
        else:
            preview_type = chart_types[raw % len(chart_types)]
        preview_data = [18 + ((raw >> (idx * 3)) % 72) for idx in range(6)]

        previews: List[Dict[str, Any]] = []
        if asset_type == AssetType.dashboard.value:
            variant_types = ["line", "bar", "pie", "bar", "line"]
            for index, variant in enumerate(variant_types):
                offset = (index - 1) * 6
                adjusted = [max(6, min(95, value + offset)) for value in preview_data]
                previews.append({"type": variant, "data": adjusted})
        else:
            previews.append({"type": preview_type, "data": preview_data})

        return {
            "summary": f"{post.title or 'Insight'} - {asset_type} summary",
            "previewLabel": preview_label_map.get(asset_type, "Insight Snapshot"),
            "previewType": preview_type,
            "previewData": preview_data,
            "previews": previews,
        }

    @staticmethod
    def _build_name(user: Optional[User], fallback: str) -> str:
        if not user:
            return fallback
        first_name = (getattr(user, "first_name", None) or "").strip()
        last_name = (getattr(user, "last_name", None) or "").strip()
        full_name = f"{first_name} {last_name}".strip()
        if full_name:
            return full_name
        maybe_name = (getattr(user, "name", None) or "").strip()
        if maybe_name:
            return maybe_name
        return fallback

    def _to_author(self, user: Optional[User], fallback_user_id: Optional[UUID]) -> FeedAuthor:
        fallback_id = str(fallback_user_id or uuid5(NAMESPACE_DNS, "unknown-feed-user"))
        fallback_name = f"User {fallback_id[:8]}"
        name = self._build_name(user, fallback_name)
        email = str(getattr(user, "email", "") or "")
        if email and "@" in email:
            username = email.split("@", 1)[0]
        else:
            username = name.lower().replace(" ", ".")

        return FeedAuthor(
            id=str(getattr(user, "id", fallback_id)),
            name=name,
            username=username,
            avatarUrl=None,
            title=getattr(user, "company", None),
        )

    async def _load_users(self, user_ids: Iterable[UUID]) -> Dict[UUID, User]:
        unique_ids = [user_id for user_id in set(user_ids) if user_id]
        if not unique_ids:
            return {}

        result = await self.db.execute(select(User).where(User.id.in_(unique_ids)))
        users = result.scalars().all()
        return {user.id: user for user in users}

    async def _load_user_reactions(
        self,
        user_id: Optional[UUID],
        posts: Sequence[FeedPost],
    ) -> Dict[UUID, str]:
        if not user_id or not posts:
            return {}

        post_ids = [post.id for post in posts]
        if not post_ids:
            return {}

        reaction_types = _reaction_values()
        stmt = select(FeedInteraction).where(
            FeedInteraction.user_id == user_id,
            FeedInteraction.post_id.in_(post_ids),
            FeedInteraction.type.in_(reaction_types),
        )
        result = await self.db.execute(stmt)

        mapped: Dict[UUID, str] = {}
        for reaction in result.scalars().all():
            mapped[reaction.post_id] = _enum_value(reaction.type)
        return mapped

    async def _load_user_bookmarks(
        self,
        user_id: Optional[UUID],
        posts: Sequence[FeedPost],
    ) -> Set[UUID]:
        if not user_id or not posts:
            return set()

        post_ids = [post.id for post in posts]
        if not post_ids:
            return set()

        stmt = select(FeedInteraction).where(
            FeedInteraction.user_id == user_id,
            FeedInteraction.post_id.in_(post_ids),
            FeedInteraction.type == "save",
        )
        result = await self.db.execute(stmt)

        bookmarked: Set[UUID] = set()
        for item in result.scalars().all():
            bookmarked.add(item.post_id)
        return bookmarked

    async def _load_followed_authors(
        self,
        user_id: Optional[UUID],
        posts: Sequence[FeedPost],
    ) -> Set[UUID]:
        if not user_id or not posts:
            return set()

        author_ids = [post.author_id for post in posts if post.author_id and post.author_id != user_id]
        if not author_ids:
            return set()

        stmt = select(FeedAuthorFollow.following_id).where(
            FeedAuthorFollow.follower_id == user_id,
            FeedAuthorFollow.following_id.in_(author_ids),
        )
        result = await self.db.execute(stmt)
        return {row[0] for row in result.all() if row[0]}

    async def _load_comment_reactions(
        self,
        comment_ids: Sequence[UUID],
        viewer_id: Optional[UUID],
    ) -> tuple[Dict[UUID, Dict[ReactionType, int]], Dict[UUID, ReactionType]]:
        if not comment_ids:
            return {}, {}

        stmt = select(FeedCommentReaction).where(FeedCommentReaction.comment_id.in_(list(comment_ids)))
        result = await self.db.execute(stmt)
        rows = result.scalars().all()

        reaction_counts: Dict[UUID, Dict[ReactionType, int]] = defaultdict(dict)
        user_reactions: Dict[UUID, ReactionType] = {}

        for row in rows:
            raw_reaction = _enum_value(row.reaction)
            try:
                typed_reaction = ReactionType(raw_reaction)
            except ValueError:
                continue

            current_count = reaction_counts[row.comment_id].get(typed_reaction, 0)
            reaction_counts[row.comment_id][typed_reaction] = current_count + 1

            if viewer_id and row.user_id == viewer_id:
                user_reactions[row.comment_id] = typed_reaction

        return reaction_counts, user_reactions

    async def _load_recent_comments(
        self,
        posts: Sequence[FeedPost],
        per_asset_limit: int = 3,
        viewer_id: Optional[UUID] = None,
    ) -> Dict[UUID, List[FeedComment]]:
        if not posts:
            return {}

        post_ids = [post.id for post in posts]
        if not post_ids:
            return {}

        stmt = (
            select(FeedCommentModel)
            .where(
                FeedCommentModel.post_id.in_(post_ids),
                FeedCommentModel.is_deleted.is_(False),
            )
            .order_by(FeedCommentModel.created_at.asc())
        )
        result = await self.db.execute(stmt)
        comments = result.scalars().all()

        grouped: Dict[UUID, List[FeedCommentModel]] = defaultdict(list)
        for comment in comments:
            grouped[comment.post_id].append(comment)

        comment_ids = [comment.id for comment in comments if comment.id]
        reaction_counts, user_reactions = await self._load_comment_reactions(comment_ids, viewer_id)

        user_map = await self._load_users(
            comment.user_id for comment in comments if comment.user_id
        )
        post_author_map: Dict[UUID, Optional[UUID]] = {post.id: post.author_id for post in posts}

        serialized: Dict[UUID, List[FeedComment]] = {}
        for key, group in grouped.items():
            by_parent: Dict[Optional[UUID], List[FeedCommentModel]] = defaultdict(list)
            for comment in group:
                by_parent[comment.parent_id].append(comment)

            top_level = by_parent.get(None, [])
            if per_asset_limit > 0:
                top_level = top_level[-per_asset_limit:]

            def serialize_comment(comment_row: FeedCommentModel) -> FeedComment:
                child_rows = by_parent.get(comment_row.id, [])
                serialized_replies = [serialize_comment(child) for child in child_rows]
                comment_reaction_map = reaction_counts.get(comment_row.id, {})

                return FeedComment(
                    id=str(comment_row.id),
                    author=self._to_author(user_map.get(comment_row.user_id), comment_row.user_id),
                    content=comment_row.content,
                    createdAt=_to_iso(comment_row.created_at),
                    parentCommentId=str(comment_row.parent_id) if comment_row.parent_id else None,
                    editedAt=_to_iso(comment_row.edited_at) if comment_row.edited_at else None,
                    isEdited=comment_row.edited_at is not None,
                    isPostAuthor=post_author_map.get(comment_row.post_id) == comment_row.user_id,
                    canEdit=bool(viewer_id and comment_row.user_id == viewer_id),
                    replyCount=len(child_rows),
                    reactions=comment_reaction_map,
                    reactionCount=sum(comment_reaction_map.values()),
                    userReaction=user_reactions.get(comment_row.id),
                    replies=serialized_replies,
                )
            serialized[key] = [serialize_comment(comment) for comment in top_level]

        return serialized

    def _build_item_response(
        self,
        post: FeedPost,
        users: Dict[UUID, User],
        reactions: Dict[UUID, str],
        bookmarks: Set[UUID],
        comments: Dict[UUID, List[FeedComment]],
        followed_authors: Optional[Set[UUID]] = None,
    ) -> FeedItemResponse:
        asset_type = _enum_value(post.asset_type)
        post_id = post.id

        try:
            typed_asset_type = AssetType(asset_type)
        except ValueError:
            typed_asset_type = AssetType.dashboard

        visibility = _enum_value(post.visibility)
        try:
            typed_visibility = FeedVisibility(visibility)
        except ValueError:
            typed_visibility = FeedVisibility.private

        approval_status = _enum_value(post.status)
        try:
            typed_approval = PublicationStatus(approval_status)
        except ValueError:
            typed_approval = PublicationStatus.draft

        reaction_value = reactions.get(post_id)
        typed_reaction: Optional[ReactionType] = None
        if reaction_value:
            try:
                typed_reaction = ReactionType(reaction_value)
            except ValueError:
                typed_reaction = None

        recent_comments = comments.get(post_id, [])
        latest_comment_time: Optional[str] = None
        if recent_comments:
            timestamps: List[str] = []

            def collect_timestamps(nodes: Sequence[FeedComment]) -> None:
                for node in nodes:
                    timestamps.append(node.createdAt)
                    if node.replies:
                        collect_timestamps(node.replies)

            collect_timestamps(recent_comments)
            if timestamps:
                latest_comment_time = max(timestamps)

        last_activity_at = latest_comment_time or _to_iso(post.published_at or post.created_at)

        return FeedItemResponse(
            id=str(post.id),
            assetType=typed_asset_type,
            assetId=str(post.asset_id),
            title=post.title or "Untitled insight",
            description=post.description or "",
            tags=list(post.tags or []),
            visibility=typed_visibility,
            approvalStatus=typed_approval,
            publishedAt=_to_iso(post.published_at or post.created_at),
            lastActivityAt=last_activity_at,
            author=self._to_author(users.get(post.author_id), post.author_id),
            metrics=FeedMetrics(
                views=int(post.view_count or 0),
                comments=int(post.comment_count or 0),
                reactions=int(post.reaction_count or 0),
                bookmarks=int(post.save_count or 0),
                shares=int(post.share_count or 0),
            ),
            userInteraction=FeedUserInteraction(
                reaction=typed_reaction,
                isBookmarked=post_id in bookmarks,
                isFollowingAuthor=bool(
                    post.author_id
                    and followed_authors is not None
                    and post.author_id in followed_authors
                ),
            ),
            recentComments=recent_comments,
            asset=self._preview_payload(post),
        )
