"""Feed service serialization helpers."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set
from uuid import NAMESPACE_DNS, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.charts.models import Chart
from src.modules.dashboards.models import Dashboard, DashboardChart
from src.modules.feed.models import FeedAuthorFollow, FeedComment as FeedCommentModel, FeedCommentReaction, FeedInteraction, FeedPost, FeedPostAttachment
from src.modules.user.models import User
from src.modules.user.avatar_storage_service import generate_avatar_sas_url
from src.modules.feed.schemas import (
    AssetType,
    FeedAttachmentPayload,
    FeedAuthor,
    FeedComment,
    FeedItemResponse,
    FeedMetrics,
    FeedRenderMode,
    FeedSnapshotInfo,
    FeedUserInteraction,
    FeedVisibility,
    PublicationStatus,
    ReactionType,
)
from src.modules.feed.service_utils import _enum_value, _normalize_asset_payload, _reaction_values, _to_iso


class FeedServiceSerializationMixin:
    db: AsyncSession

    def _preview_payload(self, post: FeedPost) -> Dict[str, Any]:
        asset_type = _enum_value(post.asset_type)
        meta = getattr(post, "preview_metadata", None) or {}
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
            preview_type = meta.get("previewType") or "insight"
        else:
            preview_type = meta.get("previewType") or chart_types[raw % len(chart_types)]
        preview_data = meta.get("previewData") or [18 + ((raw >> (idx * 3)) % 72) for idx in range(6)]

        previews: List[Dict[str, Any]] = meta.get("previews") or []
        if not previews:
            if asset_type == AssetType.dashboard.value:
                variant_types = ["line", "bar", "pie", "bar", "line"]
                for index, variant in enumerate(variant_types):
                    offset = (index - 1) * 6
                    adjusted = [max(6, min(95, value + offset)) for value in preview_data]
                    previews.append({"type": variant, "data": adjusted})
            else:
                previews.append({"type": preview_type, "data": preview_data})

        payload: Dict[str, Any] = {
            "summary": post.description or post.title or f"{asset_type} summary",
            "previewLabel": meta.get("previewLabel") or preview_label_map.get(asset_type, "Insight Snapshot"),
            "previewType": preview_type,
            "previewData": preview_data,
            "previews": previews,
        }

        for key in (
            "chartWidget",
            "dashboardId",
            "sourceQueryId",
            "excerpt",
            "questionTitle",
            "conversationId",
            "messageId",
            "thumbnailUrl",
        ):
            if meta.get(key) is not None:
                payload[key] = meta[key]

        return _normalize_asset_payload(payload)

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
        # Prefer a real identifier (email) over the synthetic "User <id>" fallback.
        email = (getattr(user, "email", None) or "").strip()
        if email:
            return email
        return fallback

    def _to_author(
        self,
        user: Optional[User],
        fallback_user_id: Optional[UUID],
        org_name: Optional[str] = None,
        include_bio: bool = False,
    ) -> FeedAuthor:
        fallback_id = str(fallback_user_id or uuid5(NAMESPACE_DNS, "unknown-feed-user"))
        fallback_name = f"User {fallback_id[:8]}"
        name = self._build_name(user, fallback_name)
        email = str(getattr(user, "email", "") or "")
        username = (getattr(user, "username", None) or "").strip()
        if not username:
            # Not persisted anywhere - recomputed fresh every serialization,
            # so it must be deterministic AND collision-proof on its own.
            # The plain email-local-part (or slugified name) used here before
            # was neither: two real accounts in this DB share the email
            # "demo@dataticon.com" under different auth providers (a
            # legitimate, supported case - uq_users_email_provider is unique
            # on (email, provider), not email alone) and both landed on the
            # identical fallback username "demod" - get_public_author_profile's
            # lookup then non-deterministically resolved to whichever row
            # Postgres happened to return first, silently showing one
            # account's profile/posts under the other's link, or a "not
            # found" 404 for accounts with neither email nor name to derive
            # anything from at all. Suffixing with a fragment of the real
            # (always unique) user id fixes both: no two accounts can ever
            # produce the same fallback slug, and even a fully bare account
            # gets one that's guaranteed to exist and resolve. The lookup
            # side (get_public_author_profile) parses this same suffix back
            # out to find the exact account it names.
            id_suffix = fallback_id.replace("-", "")[:8]
            if email and "@" in email:
                username = f"{email.split('@', 1)[0]}-{id_suffix}"
            else:
                username = f"user-{id_suffix}"

        avatar_url = getattr(user, "avatar_url", None)
        if avatar_url:
            # The default 1h expiry (fine for a profile page that re-fetches
            # on load) is too short here: a feed item can sit rendered in
            # infinite-scroll/React Query cache for much longer than an hour
            # without a natural refetch, so the signed URL silently expires
            # underneath an already-displayed post and the avatar falls back
            # to the initial letter with no error surfaced anywhere. A day is
            # a reasonable session-length window for what's just a
            # broadly org-visible profile photo, not sensitive data.
            avatar_url = generate_avatar_sas_url(avatar_url, expiry_hours=24)

        # "Company" alone (the old behavior) read as just a name with no
        # context - Settings -> Profile also has a Job Role field, and
        # "<role> @ <org>" is the standard way a byline actually reads
        # (LinkedIn/Twitter bio convention). Real org membership
        # (user_roles -> organizations) is preferred over the self-reported
        # Company text when both exist - they can genuinely differ.
        job_role = (getattr(user, "job_role", None) or "").strip() or None
        org_or_company = org_name or getattr(user, "company", None)
        if job_role and org_or_company:
            title = f"{job_role} @ {org_or_company}"
        else:
            title = job_role or org_or_company

        return FeedAuthor(
            id=str(getattr(user, "id", fallback_id)),
            name=name,
            username=username,
            avatarUrl=avatar_url,
            title=title,
            bio=(getattr(user, "bio", None) or None) if include_bio else None,
        )

    async def _load_primary_organizations(self, user_ids: Iterable[UUID]) -> Dict[UUID, str]:
        """Bulk-resolve each user's primary organization name via user_roles.

        EE-only (RBAC/org-membership doesn't exist in CE) - fails open to an
        empty map so callers fall back to the self-reported company field.
        A user can hold multiple org-scoped roles (e.g. owner of one org,
        member of another via a project); org_owner rows are preferred as
        the clearest "this is their org" signal, otherwise the first
        organization-scoped role found wins.
        """
        unique_ids = [user_id for user_id in set(user_ids) if user_id]
        if not unique_ids:
            return {}

        try:
            from src.modules.authentication.rbac.models import Role, UserRole
            from src.modules.organizations.models import Organization
        except ImportError:
            return {}

        stmt = (
            select(UserRole.user_id, Organization.name, Role.name)
            .join(Organization, Organization.id == UserRole.organization_id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.user_id.in_(unique_ids),
                UserRole.organization_id.isnot(None),
                UserRole.is_deleted.is_(False),
            )
        )
        result = await self.db.execute(stmt)

        org_by_user: Dict[UUID, str] = {}
        for user_id, org_name, role_name in result.all():
            if not org_name:
                continue
            if user_id not in org_by_user or role_name == "org_owner":
                org_by_user[user_id] = org_name
        return org_by_user

    async def _load_users(self, user_ids: Iterable[UUID]) -> Dict[UUID, User]:
        unique_ids = [user_id for user_id in set(user_ids) if user_id]
        if not unique_ids:
            return {}

        from sqlalchemy import or_

        result = await self.db.execute(
            select(User).where(or_(User.id.in_(unique_ids), User.user_id.in_(unique_ids)))
        )
        users = result.scalars().all()
        user_map: Dict[UUID, User] = {}

        def profile_score(user: User) -> int:
            score = 0
            if (getattr(user, "first_name", None) or "").strip():
                score += 2
            if (getattr(user, "last_name", None) or "").strip():
                score += 2
            if (getattr(user, "email", None) or "").strip():
                score += 1
            if (getattr(user, "username", None) or "").strip():
                score += 1
            if (getattr(user, "avatar_url", None) or "").strip():
                score += 1
            return score

        def put_user(key: Optional[UUID], user: User) -> None:
            if not key:
                return
            existing = user_map.get(key)
            if existing is None or profile_score(user) > profile_score(existing):
                user_map[key] = user

        for user in users:
            put_user(user.id, user)
            put_user(user.user_id, user)
        return user_map

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

    async def _load_post_reaction_breakdown(
        self,
        posts: Sequence[FeedPost],
    ) -> Dict[UUID, Dict[ReactionType, int]]:
        """Per-type reaction counts for each post (e.g. {like: 3, love: 1}) -
        mirrors _load_comment_reactions, which comments already have; posts
        only exposed a flat total until now."""
        post_ids = [post.id for post in posts]
        if not post_ids:
            return {}

        reaction_types = _reaction_values()
        stmt = select(FeedInteraction.post_id, FeedInteraction.type).where(
            FeedInteraction.post_id.in_(post_ids),
            FeedInteraction.type.in_(reaction_types),
        )
        result = await self.db.execute(stmt)

        breakdown: Dict[UUID, Dict[ReactionType, int]] = defaultdict(dict)
        for post_id, raw_type in result.all():
            try:
                typed_reaction = ReactionType(_enum_value(raw_type))
            except ValueError:
                continue
            per_post = breakdown[post_id]
            per_post[typed_reaction] = per_post.get(typed_reaction, 0) + 1
        return breakdown

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

    async def _load_post_attachments(
        self,
        posts: Sequence[FeedPost],
        *,
        viewer_id: Optional[UUID],
    ) -> Dict[UUID, List[FeedAttachmentPayload]]:
        """Batched, per-VIEWER attachment loader. Each attachment is backed by
        a real feed publication (`referenced_post_id`, auto-published on
        attach - see publish_asset's attachment loop / _get_or_create_
        attachment_publication) - so visibility is just that publication's
        own existing visibility check (_can_view_post) and the preview is
        that publication's own already-computed preview payload, the same
        one a normal feed post renders with. A post's own visibility doesn't
        imply every viewer can also see every publication it references, so
        this is re-checked per VIEWER here, independent of whatever the
        author could see at attach time. A viewer who can't see it gets
        restricted=True with no title/preview leaked, so the card shows
        "Restricted" instead of the post silently looking incomplete. A
        referenced_post_id that no longer resolves (publication deleted, or
        a pre-migration row that predates this field) renders as "no longer
        available" the same way.
        """
        post_ids = [post.id for post in posts]
        if not post_ids:
            return {}

        result = await self.db.execute(
            select(FeedPostAttachment)
            .where(FeedPostAttachment.post_id.in_(post_ids))
            .order_by(FeedPostAttachment.post_id, FeedPostAttachment.position)
        )
        attachments = result.scalars().all()
        if not attachments:
            return {}

        referenced_ids = {a.referenced_post_id for a in attachments if a.referenced_post_id}
        referenced_posts: Dict[UUID, FeedPost] = {}
        if referenced_ids:
            rows = await self.db.execute(select(FeedPost).where(FeedPost.id.in_(referenced_ids)))
            referenced_posts = {p.id: p for p in rows.scalars().all()}

        previews = (
            await self._load_preview_payloads(list(referenced_posts.values()))
            if referenced_posts
            else {}
        )

        # A chart attachment's live preview needs its PARENT dashboard's id
        # (chartService.getChart(dashboardId, chartId) - see FeedPreviewVisual's
        # ChartLivePreview) - not stored in preview_metadata for auto-published
        # attachment publications (they're published with no metadata at all),
        # so look it up the same way the deep-link fix earlier did: via the
        # dashboard_charts placement table, the one the live dashboards app
        # itself actually uses (not the standalone charts table's own
        # dashboard_id column, unpopulated in practice).
        chart_asset_ids = {
            a.asset_id
            for a in attachments
            if _enum_value(a.asset_type) == "chart" and a.referenced_post_id in referenced_posts
        }
        chart_dashboard_ids: Dict[UUID, UUID] = {}
        if chart_asset_ids:
            placement_rows = await self.db.execute(
                select(DashboardChart.chart_id, DashboardChart.dashboard_id).where(
                    DashboardChart.chart_id.in_(chart_asset_ids)
                )
            )
            for chart_id, dashboard_id in placement_rows.all():
                chart_dashboard_ids.setdefault(chart_id, dashboard_id)

        # The same publication can be attached to multiple posts on one page
        # (e.g. a popular dashboard referenced by several discussion posts) -
        # cache the per-viewer visibility check instead of re-running it once
        # per attachment row.
        access_cache: Dict[UUID, bool] = {}

        async def _viewer_can_see(referenced_post: FeedPost) -> bool:
            if not viewer_id:
                return False
            if referenced_post.id not in access_cache:
                access_cache[referenced_post.id] = await self._can_view_post(referenced_post, viewer_id)
            return access_cache[referenced_post.id]

        by_post: Dict[UUID, List[FeedAttachmentPayload]] = defaultdict(list)
        for attachment in attachments:
            asset_type = _enum_value(attachment.asset_type)
            referenced_post = referenced_posts.get(attachment.referenced_post_id) if attachment.referenced_post_id else None

            if not referenced_post:
                by_post[attachment.post_id].append(
                    FeedAttachmentPayload(asset_type=asset_type, asset_id=str(attachment.asset_id), restricted=True)
                )
                continue

            if not await _viewer_can_see(referenced_post):
                by_post[attachment.post_id].append(
                    FeedAttachmentPayload(asset_type=asset_type, asset_id=str(attachment.asset_id), restricted=True)
                )
                continue

            preview = previews.get(referenced_post.id) or {}
            dashboard_id = (
                preview.get("dashboardId")
                or (str(chart_dashboard_ids[attachment.asset_id]) if attachment.asset_id in chart_dashboard_ids else None)
                if asset_type == "chart"
                else None
            )
            by_post[attachment.post_id].append(
                FeedAttachmentPayload(
                    asset_type=asset_type,
                    asset_id=str(attachment.asset_id),
                    restricted=False,
                    title=referenced_post.title,
                    description=referenced_post.description,
                    referencedPostId=str(referenced_post.id),
                    renderMode=_enum_value(referenced_post.render_mode) or "live",
                    dashboardId=dashboard_id,
                    previewType=preview.get("previewType"),
                    previewData=preview.get("previewData"),
                    previews=preview.get("previews"),
                    chartWidget=preview.get("chartWidget"),
                    snapshotPayload=preview.get("snapshotPayload"),
                )
            )
        return by_post

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
        org_map = await self._load_primary_organizations(
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
                    author=self._to_author(
                        user_map.get(comment_row.user_id),
                        comment_row.user_id,
                        org_name=org_map.get(comment_row.user_id),
                    ),
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
        preview_payload: Optional[Dict[str, Any]] = None,
        viewer_id: Optional[UUID] = None,
        org_names: Optional[Dict[UUID, str]] = None,
        attachments: Optional[Dict[UUID, List[FeedAttachmentPayload]]] = None,
        reaction_breakdown: Optional[Dict[UUID, Dict[ReactionType, int]]] = None,
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

        render_mode_raw = _enum_value(getattr(post, "render_mode", None)) or FeedRenderMode.live.value
        try:
            typed_render_mode = FeedRenderMode(render_mode_raw)
        except ValueError:
            typed_render_mode = FeedRenderMode.live

        snapshot_info: Optional[FeedSnapshotInfo] = None
        if typed_render_mode == FeedRenderMode.snapshot and int(getattr(post, "snapshot_version", 0) or 0) > 0:
            captured_at = None
            if preview_payload:
                captured_at = preview_payload.get("snapshotCapturedAt")
                if not captured_at and preview_payload.get("snapshotPayload"):
                    snap_raw = preview_payload["snapshotPayload"]
                    if isinstance(snap_raw, dict):
                        captured_at = snap_raw.get("capturedAt")
            snapshot_info = FeedSnapshotInfo(
                version=int(getattr(post, "snapshot_version", 0) or 0),
                capturedAt=str(captured_at) if captured_at else None,
                renderMode=FeedRenderMode.snapshot,
            )

        is_owner = bool(
            viewer_id and post.author_id and str(post.author_id) == str(viewer_id)
        )

        return FeedItemResponse(
            id=str(post.id),
            assetType=typed_asset_type,
            assetId=str(post.asset_id),
            title=post.title or ("" if asset_type == AssetType.post.value else "Untitled insight"),
            description=post.description or "",
            tags=list(post.tags or []),
            visibility=typed_visibility,
            approvalStatus=typed_approval,
            publishedAt=_to_iso(post.published_at or post.created_at),
            lastActivityAt=last_activity_at,
            author=self._to_author(
                users.get(post.author_id),
                post.author_id,
                org_name=(org_names or {}).get(post.author_id),
            ),
            metrics=FeedMetrics(
                views=int(post.view_count or 0),
                comments=int(post.comment_count or 0),
                reactions=int(post.reaction_count or 0),
                bookmarks=int(post.save_count or 0),
                shares=int(post.share_count or 0),
                reactionBreakdown=(reaction_breakdown or {}).get(post_id, {}),
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
            asset=_normalize_asset_payload(
                preview_payload if preview_payload is not None else self._preview_payload(post)
            ),
            renderMode=typed_render_mode,
            snapshot=snapshot_info,
            isOwner=is_owner,
            attachments=(attachments or {}).get(post_id, []),
            mentions=[str(m) for m in (post.mentions or [])],
            editedAt=_to_iso(post.edited_at) if getattr(post, "edited_at", None) else None,
            isEdited=getattr(post, "edited_at", None) is not None,
            canEdit=is_owner and asset_type == AssetType.post.value,
        )
