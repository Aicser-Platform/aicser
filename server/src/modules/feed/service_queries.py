"""Feed service read/query helpers."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Set
from uuid import UUID

from sqlalchemy import and_, func, or_, select, false
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from src.core.edition import is_ee_enabled
try:
    from src.modules.authentication.rbac.models import Role, UserRole
except ImportError:
    Role = None  # type: ignore
    UserRole = None  # type: ignore
from src.modules.feed.models import FeedAuthorFollow, FeedCollection, FeedCollectionItem as FeedCollectionItemModel, FeedComment as FeedCommentModel, FeedEvent, FeedInteraction, FeedNotification, FeedPost, FeedView
from src.modules.user.models import User
from src.modules.feed.schemas import (
    AssetType,
    ActivityFeedItem,
    ActivityFeedResponse,
    ApprovalQueueItem,
    ApprovalQueueResponse,
    FeedAssetCounts,
    FeedCollectionDetail,
    FeedCollectionItem,
    FeedCollectionListResponse,
    FeedCollectionSummary,
    FeedFilterOptionsResponse,
    FeedItemResponse,
    FeedLeaderboardItem,
    FeedLeaderboardTrend,
    FeedRecommendedItem,
    FeedResponse,
    FeedScope,
    FeedSidebarActivity,
    FeedSidebarCollection,
    FeedSidebarResponse,
    FeedSidebarTag,
    FeedSort,
    FeedTopContributor,
    FeedUserInteraction,
    FeedVisibility,
    LeaderboardSortBy,
    LeaderboardTimeRange,
    NotificationItem,
    NotificationResponse,
    PublicationStatus,
    PublicationLookupResponse,
    PublicAuthorProfileResponse,
    PublicAuthorStats,
    DigestPreviewItem,
    DigestPreviewResponse,
    PublicLeaderboardResponse,
    RemixFeedResponse,
    ReactionType,
)
from src.modules.feed.service_utils import _enum_value, _safe_uuid, _time_ago, _to_iso


class FeedServiceQueryMixin:
    db: AsyncSession

    @staticmethod
    def _visibility_access_filters(user_id: Optional[UUID]) -> List[Any]:
        if not user_id:
            return [
                and_(
                    FeedPost.visibility == FeedVisibility.public.value,
                    FeedPost.public_access_level == "results_only",
                    FeedPost.requires_login.is_(False),
                )
            ]

        if not is_ee_enabled() or UserRole is None:
            return [
                and_(
                    FeedPost.visibility == FeedVisibility.public.value,
                    FeedPost.public_access_level == "results_only",
                ),
                and_(
                    FeedPost.author_id == user_id,
                    FeedPost.visibility == FeedVisibility.private.value,
                ),
            ]

        org_ids_stmt = (
            select(UserRole.organization_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.organization_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        project_ids_stmt = (
            select(UserRole.project_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.project_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        return [
            and_(
                FeedPost.visibility == FeedVisibility.public.value,
                FeedPost.public_access_level == "results_only",
            ),
            and_(
                FeedPost.organization_id.in_(org_ids_stmt),
                FeedPost.visibility == FeedVisibility.organization.value,
            ),
            and_(
                FeedPost.project_id.in_(project_ids_stmt),
                FeedPost.visibility == FeedVisibility.project.value,
            ),
            and_(
                FeedPost.author_id == user_id,
                FeedPost.visibility == FeedVisibility.private.value,
            ),
        ]

    async def _can_view_post(self, post: FeedPost, user_id: Optional[UUID]) -> bool:
        visibility = _enum_value(post.visibility)

        if visibility == FeedVisibility.public.value:
            if _enum_value(post.public_access_level) != "results_only":
                return False
            return not (post.requires_login and not user_id)

        if not user_id:
            return False

        if not is_ee_enabled():
            if visibility == FeedVisibility.private.value:
                return post.author_id == user_id
            return post.author_id == user_id

        if visibility == FeedVisibility.private.value:
            return post.author_id == user_id

        if visibility == FeedVisibility.organization.value:
            if not post.organization_id:
                return False
            role_id = await self.db.scalar(
                select(UserRole.id).where(
                    UserRole.user_id == user_id,
                    UserRole.organization_id == post.organization_id,
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            )
            return role_id is not None

        if visibility == FeedVisibility.project.value:
            if not post.project_id:
                return False
            role_id = await self.db.scalar(
                select(UserRole.id).where(
                    UserRole.user_id == user_id,
                    UserRole.project_id == post.project_id,
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            )
            return role_id is not None

        return False

    def _feed_scope_filters(
        self,
        scope: FeedScope,
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
    ) -> List[Any]:
        filters: List[Any] = []

        if scope == FeedScope.private:
            if user_id:
                filters.append(
                    and_(
                        FeedPost.author_id == user_id,
                        FeedPost.visibility == FeedVisibility.private.value,
                    )
                )
            else:
                filters.append(false())
        elif scope == FeedScope.organization:
            if organization_id:
                filters.append(
                    or_(
                        and_(
                            FeedPost.organization_id == organization_id,
                            FeedPost.visibility == FeedVisibility.organization.value,
                        ),
                        FeedPost.visibility == FeedVisibility.public.value,
                    )
                )
            else:
                if user_id:
                    org_ids_stmt = (
                        select(UserRole.organization_id)
                        .where(
                            UserRole.user_id == user_id,
                            UserRole.organization_id.isnot(None),
                            UserRole.is_active.is_(True),
                            UserRole.is_deleted.is_(False),
                        )
                    )
                    filters.append(
                        and_(
                            FeedPost.organization_id.in_(org_ids_stmt),
                            FeedPost.visibility.in_(
                                [FeedVisibility.organization.value, FeedVisibility.public.value]
                            ),
                        )
                    )
                else:
                    filters.append(
                        FeedPost.visibility.in_(
                            [FeedVisibility.organization.value, FeedVisibility.public.value]
                        )
                    )
        elif scope == FeedScope.project:
            if project_id:
                filters.append(
                    and_(
                        FeedPost.project_id == project_id,
                        FeedPost.visibility == FeedVisibility.project.value,
                    )
                )
            else:
                if user_id:
                    project_ids_stmt = (
                        select(UserRole.project_id)
                        .where(
                            UserRole.user_id == user_id,
                            UserRole.project_id.isnot(None),
                            UserRole.is_active.is_(True),
                            UserRole.is_deleted.is_(False),
                        )
                    )
                    filters.append(
                        and_(
                            FeedPost.project_id.in_(project_ids_stmt),
                            FeedPost.visibility == FeedVisibility.project.value,
                        )
                    )
                else:
                    filters.append(FeedPost.visibility == FeedVisibility.project.value)
        elif scope == FeedScope.following:
            if not user_id:
                filters.append(false())
            else:
                followed_authors_stmt = select(FeedAuthorFollow.following_id).where(
                    FeedAuthorFollow.follower_id == user_id
                )
                filters.append(FeedPost.author_id.in_(followed_authors_stmt))
                filters.append(or_(*self._visibility_access_filters(user_id)))
        elif scope == FeedScope.public:
            filters.append(FeedPost.visibility == FeedVisibility.public.value)
            filters.append(FeedPost.public_access_level == "results_only")
        else:
            filters.append(
                FeedPost.visibility.in_(
                    [FeedVisibility.organization.value, FeedVisibility.public.value]
                )
            )

        return filters

    @staticmethod
    def _ordering(sort: FeedSort) -> List[Any]:
        base_recent = func.coalesce(FeedPost.published_at, FeedPost.created_at).desc()

        if sort == FeedSort.recent:
            return [base_recent]

        if sort == FeedSort.trending:
            trending_score = (
                FeedPost.reaction_count
                + FeedPost.comment_count
                + FeedPost.save_count
            )
            return [trending_score.desc(), base_recent]

        recommended_score = (
            FeedPost.view_count
            + (FeedPost.reaction_count * 2)
            + (FeedPost.save_count * 3)
        )
        return [recommended_score.desc(), base_recent]

    @staticmethod
    def _search_filter(search: Optional[str]) -> Optional[Any]:
        clean_search = (search or "").strip()
        if not clean_search:
            return None

        pattern = f"%{clean_search}%"
        return or_(
            func.coalesce(FeedPost.title, "").ilike(pattern),
            func.coalesce(FeedPost.description, "").ilike(pattern),
            func.coalesce(func.array_to_string(FeedPost.tags, " "), "").ilike(pattern),
        )

    async def _fetch_feed_response(
        self,
        base_stmt: Any,
        sort: FeedSort,
        limit: int,
        offset: int,
        user_id: Optional[UUID],
    ) -> FeedResponse:
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int(await self.db.scalar(count_stmt) or 0)

        stmt = base_stmt.order_by(*self._ordering(sort)).offset(offset).limit(limit)
        result = await self.db.execute(stmt)
        posts = result.scalars().all()

        users = await self._load_users(post.author_id for post in posts if post.author_id)
        reactions = await self._load_user_reactions(user_id, posts)
        bookmarks = await self._load_user_bookmarks(user_id, posts)
        followed_authors = await self._load_followed_authors(user_id, posts)
        comments = await self._load_recent_comments(posts, viewer_id=user_id)
        previews = await self._load_preview_payloads(posts, max_snapshot_widgets=6)

        items = [
            self._build_item_response(
                post=post,
                users=users,
                reactions=reactions,
                bookmarks=bookmarks,
                comments=comments,
                followed_authors=followed_authors,
                preview_payload=previews.get(post.id),
                viewer_id=user_id,
            )
            for post in posts
        ]

        return FeedResponse(items=items, total=total, limit=limit, offset=offset)

    async def get_feed(
        self,
        *,
        scope: FeedScope,
        sort: FeedSort,
        tags: Optional[List[str]],
        search: Optional[str],
        author_id: Optional[str],
        asset_type: Optional[AssetType],
        time_window_days: Optional[int],
        limit: int,
        offset: int,
        user_payload: Optional[Dict[str, Any]],
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
    ) -> FeedResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        filters: List[Any] = []

        if user_id:
            filters.append(
                or_(
                    FeedPost.status == PublicationStatus.approved.value,
                    FeedPost.author_id == user_id,
                )
            )
        else:
            filters.append(FeedPost.status == PublicationStatus.approved.value)

        filters.extend(
            self._feed_scope_filters(
                scope, organization_id=organization_id, project_id=project_id, user_id=user_id
            )
        )

        if asset_type:
            filters.append(FeedPost.asset_type == asset_type.value)

        if tags:
            for tag in tags:
                clean_tag = tag.strip()
                if clean_tag:
                    filters.append(FeedPost.tags.any(clean_tag))

        search_filter = self._search_filter(search)
        if search_filter is not None:
            filters.append(search_filter)

        if author_id:
            author_uuid = _safe_uuid(author_id)
            if author_uuid:
                filters.append(FeedPost.author_id == author_uuid)

        if time_window_days and time_window_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=time_window_days)
            filters.append(func.coalesce(FeedPost.published_at, FeedPost.created_at) >= cutoff)

        if scope == FeedScope.public and not user_id:
            filters.append(FeedPost.requires_login.is_(False))

        stmt = select(FeedPost).where(and_(*filters))
        return await self._fetch_feed_response(stmt, sort, limit, offset, user_id)

    async def get_saved_feed(
        self,
        *,
        sort: FeedSort,
        limit: int,
        offset: int,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if not user_id:
            return FeedResponse(items=[], total=0, limit=limit, offset=offset)

        saved_post_ids_stmt = select(FeedInteraction.post_id).where(
            FeedInteraction.user_id == user_id,
            FeedInteraction.type == "save",
        )

        approval_filter = or_(
            FeedPost.status == PublicationStatus.approved.value,
            FeedPost.author_id == user_id,
        )
        org_ids_stmt = (
            select(UserRole.organization_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.organization_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        project_ids_stmt = (
            select(UserRole.project_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.project_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        accessible_filters: List[Any] = [
            FeedPost.visibility == FeedVisibility.public.value,
            and_(
                FeedPost.organization_id.in_(org_ids_stmt),
                FeedPost.visibility == FeedVisibility.organization.value,
            ),
            and_(
                FeedPost.project_id.in_(project_ids_stmt),
                FeedPost.visibility == FeedVisibility.project.value,
            ),
            and_(
                FeedPost.author_id == user_id,
                FeedPost.visibility == FeedVisibility.private.value,
            ),
        ]

        stmt = (
            select(FeedPost)
            .where(
                FeedPost.id.in_(saved_post_ids_stmt),
                approval_filter,
                or_(*accessible_filters),
            )
        )

        return await self._fetch_feed_response(stmt, sort, limit, offset, user_id)

    async def get_commented_feed(
        self,
        *,
        sort: FeedSort,
        limit: int,
        offset: int,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if not user_id:
            return FeedResponse(items=[], total=0, limit=limit, offset=offset)

        commented_post_ids_stmt = select(FeedCommentModel.post_id).where(
            FeedCommentModel.user_id == user_id,
        )

        approval_filter = or_(
            FeedPost.status == PublicationStatus.approved.value,
            FeedPost.author_id == user_id,
        )
        org_ids_stmt = (
            select(UserRole.organization_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.organization_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        project_ids_stmt = (
            select(UserRole.project_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.project_id.isnot(None),
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        accessible_filters: List[Any] = [
            FeedPost.visibility == FeedVisibility.public.value,
            and_(
                FeedPost.organization_id.in_(org_ids_stmt),
                FeedPost.visibility == FeedVisibility.organization.value,
            ),
            and_(
                FeedPost.project_id.in_(project_ids_stmt),
                FeedPost.visibility == FeedVisibility.project.value,
            ),
            and_(
                FeedPost.author_id == user_id,
                FeedPost.visibility == FeedVisibility.private.value,
            ),
        ]

        stmt = (
            select(FeedPost)
            .where(
                FeedPost.id.in_(commented_post_ids_stmt),
                approval_filter,
                or_(*accessible_filters),
            )
        )

        return await self._fetch_feed_response(stmt, sort, limit, offset, user_id)

    async def get_item_by_id(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> Optional[FeedItemResponse]:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        post = await self.db.scalar(select(FeedPost).where(FeedPost.id == item_id))
        if not post:
            return None

        if (
            _enum_value(post.status) != PublicationStatus.approved.value
            and post.author_id != user_id
        ):
            return None
        if not await self._can_view_post(post, user_id):
            return None

        users = await self._load_users([post.author_id] if post.author_id else [])
        reactions = await self._load_user_reactions(user_id, [post])
        bookmarks = await self._load_user_bookmarks(user_id, [post])
        followed_authors = await self._load_followed_authors(user_id, [post])
        comments = await self._load_recent_comments([post], per_asset_limit=100, viewer_id=user_id)
        previews = await self._load_preview_payloads([post])

        return self._build_item_response(
            post,
            users,
            reactions,
            bookmarks,
            comments,
            followed_authors=followed_authors,
            preview_payload=previews.get(post.id),
            viewer_id=user_id,
        )

    async def get_public_item_by_id(self, item_id: UUID) -> Optional[FeedItemResponse]:
        """Approved public posts viewable without authentication."""
        await self._seed_mock_data_if_empty()
        post = await self.db.scalar(select(FeedPost).where(FeedPost.id == item_id))
        if not post:
            return None
        if _enum_value(post.visibility) != FeedVisibility.public.value:
            return None
        if _enum_value(post.status) != PublicationStatus.approved.value:
            return None
        return await self.get_item_by_id(item_id, user_payload=None)

    async def get_filter_options(
        self,
        user_payload: Optional[Dict[str, Any]],
        *,
        scope: FeedScope = FeedScope.organization,
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
    ) -> FeedFilterOptionsResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if user_id:
            filters: List[Any] = [
                or_(
                    FeedPost.status == PublicationStatus.approved.value,
                    FeedPost.author_id == user_id,
                )
            ]
        else:
            filters = [FeedPost.status == PublicationStatus.approved.value]

        filters.extend(
            self._feed_scope_filters(
                scope, organization_id=organization_id, project_id=project_id, user_id=user_id
            )
        )
        if scope == FeedScope.public and not user_id:
            filters.append(FeedPost.requires_login.is_(False))

        stmt = select(FeedPost).where(and_(*filters))
        result = await self.db.execute(stmt)
        posts = result.scalars().all()

        tag_counter: Counter[str] = Counter()
        author_ids: Set[UUID] = set()
        asset_counts = FeedAssetCounts(dashboard=0, chart=0, insight=0)

        for post in posts:
            tag_counter.update([tag for tag in (post.tags or []) if tag])
            if post.author_id:
                author_ids.add(post.author_id)
            asset_type_value = _enum_value(post.asset_type)
            if asset_type_value == AssetType.dashboard.value:
                asset_counts.dashboard += 1
            elif asset_type_value == AssetType.chart.value:
                asset_counts.chart += 1
            elif asset_type_value == AssetType.insight.value:
                asset_counts.insight += 1
            elif asset_type_value == AssetType.query.value:
                asset_counts.query += 1

        users = await self._load_users(author_ids)
        authors = [self._to_author(users.get(author_id), author_id) for author_id in author_ids]
        authors.sort(key=lambda item: item.name.lower())

        ordered_tags = [
            tag for tag, _ in sorted(tag_counter.items(), key=lambda entry: (-entry[1], entry[0]))
        ]

        return FeedFilterOptionsResponse(tags=ordered_tags, authors=authors, assetCounts=asset_counts)

    async def get_sidebar_data(
        self,
        *,
        user_payload: Optional[Dict[str, Any]],
        scope: FeedScope,
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
        time_range: LeaderboardTimeRange = LeaderboardTimeRange.week,
        content_type: Optional[AssetType] = None,
        sort_by: LeaderboardSortBy = LeaderboardSortBy.popular,
        leaderboard_limit: int = 8,
    ) -> FeedSidebarResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)

        post_filters: List[Any] = [FeedPost.status == PublicationStatus.approved.value]
        post_filters.extend(
            self._feed_scope_filters(
                scope, organization_id=organization_id, project_id=project_id, user_id=user_id
            )
        )
        if scope == FeedScope.public and not user_id:
            post_filters.append(FeedPost.requires_login.is_(False))

        posts_stmt = select(FeedPost).where(and_(*post_filters))
        posts_result = await self.db.execute(posts_stmt)
        posts = posts_result.scalars().all()

        tag_counter: Counter[str] = Counter()
        for post in posts:
            tag_counter.update([tag for tag in post.tags or [] if tag])

        trending_tags = [
            FeedSidebarTag(tag=tag, count=count)
            for tag, count in sorted(tag_counter.items(), key=lambda item: (-item[1], item[0]))[:6]
        ]

        now = datetime.now(timezone.utc)
        time_window_days = {
            LeaderboardTimeRange.today: 1,
            LeaderboardTimeRange.week: 7,
            LeaderboardTimeRange.month: 30,
        }.get(time_range)
        leaderboard_cutoff = (
            datetime.now(timezone.utc) - timedelta(days=time_window_days)
            if time_window_days
            else None
        )

        filtered_posts: List[FeedPost] = []
        for post in posts:
            if content_type and _enum_value(post.asset_type) != content_type.value:
                continue
            published_at = post.published_at or post.created_at
            if leaderboard_cutoff and published_at and published_at < leaderboard_cutoff:
                continue
            filtered_posts.append(post)

        def _leaderboard_score(post: FeedPost, mode: LeaderboardSortBy) -> int:
            views = int(post.view_count or 0)
            reactions = int(post.reaction_count or 0)
            comments = int(post.comment_count or 0)
            saves = int(post.save_count or 0)
            shares = int(post.share_count or 0)
            if mode == LeaderboardSortBy.voted:
                return reactions
            if mode == LeaderboardSortBy.viewed:
                return views
            if mode == LeaderboardSortBy.discussed:
                return comments
            return views + (reactions * 2) + (comments * 2) + (saves * 3) + (shares * 2)

        filtered_posts.sort(
            key=lambda post: (
                _leaderboard_score(post, sort_by),
                post.published_at or post.created_at or now,
            ),
            reverse=True,
        )
        leaderboard_posts = filtered_posts[: max(3, min(leaderboard_limit, 20))]

        leaderboard_post_ids = [post.id for post in leaderboard_posts if post.id]

        current_metrics: Dict[UUID, Dict[str, int]] = {}
        previous_metrics: Dict[UUID, Dict[str, int]] = {}
        if leaderboard_post_ids:
            trend_days = time_window_days or 30
            current_start = now - timedelta(days=trend_days)
            previous_start = current_start - timedelta(days=trend_days)

            base_metric = {
                "views": 0,
                "reaction": 0,
                "comment": 0,
                "save": 0,
                "share": 0,
            }
            current_metrics = {post_id: dict(base_metric) for post_id in leaderboard_post_ids}
            previous_metrics = {post_id: dict(base_metric) for post_id in leaderboard_post_ids}

            event_types = ["reaction", "comment", "save", "share"]

            current_event_result = await self.db.execute(
                select(FeedEvent.post_id, FeedEvent.type, func.count())
                .where(
                    FeedEvent.post_id.in_(leaderboard_post_ids),
                    FeedEvent.type.in_(event_types),
                    FeedEvent.created_at >= current_start,
                    FeedEvent.created_at < now,
                )
                .group_by(FeedEvent.post_id, FeedEvent.type)
            )
            for post_id, event_type, count in current_event_result.all():
                if post_id in current_metrics:
                    metric_key = _enum_value(event_type)
                    if metric_key in current_metrics[post_id]:
                        current_metrics[post_id][metric_key] = int(count or 0)

            previous_event_result = await self.db.execute(
                select(FeedEvent.post_id, FeedEvent.type, func.count())
                .where(
                    FeedEvent.post_id.in_(leaderboard_post_ids),
                    FeedEvent.type.in_(event_types),
                    FeedEvent.created_at >= previous_start,
                    FeedEvent.created_at < current_start,
                )
                .group_by(FeedEvent.post_id, FeedEvent.type)
            )
            for post_id, event_type, count in previous_event_result.all():
                if post_id in previous_metrics:
                    metric_key = _enum_value(event_type)
                    if metric_key in previous_metrics[post_id]:
                        previous_metrics[post_id][metric_key] = int(count or 0)

            current_view_result = await self.db.execute(
                select(FeedView.post_id, func.count())
                .where(
                    FeedView.post_id.in_(leaderboard_post_ids),
                    FeedView.viewed_at >= current_start,
                    FeedView.viewed_at < now,
                )
                .group_by(FeedView.post_id)
            )
            for post_id, count in current_view_result.all():
                if post_id in current_metrics:
                    current_metrics[post_id]["views"] = int(count or 0)

            previous_view_result = await self.db.execute(
                select(FeedView.post_id, func.count())
                .where(
                    FeedView.post_id.in_(leaderboard_post_ids),
                    FeedView.viewed_at >= previous_start,
                    FeedView.viewed_at < current_start,
                )
                .group_by(FeedView.post_id)
            )
            for post_id, count in previous_view_result.all():
                if post_id in previous_metrics:
                    previous_metrics[post_id]["views"] = int(count or 0)

        leaderboard_users = await self._load_users(
            post.author_id for post in leaderboard_posts if post.author_id
        )
        leaderboard_reactions = await self._load_user_reactions(user_id, leaderboard_posts)
        leaderboard_bookmarks = await self._load_user_bookmarks(user_id, leaderboard_posts)
        followed_authors = await self._load_followed_authors(user_id, leaderboard_posts)

        def _popular_score(metric: Dict[str, int]) -> int:
            return (
                int(metric.get("views", 0))
                + (int(metric.get("reaction", 0)) * 2)
                + (int(metric.get("comment", 0)) * 2)
                + (int(metric.get("save", 0)) * 3)
                + (int(metric.get("share", 0)) * 2)
            )

        leaderboard: List[FeedLeaderboardItem] = []
        for index, post in enumerate(leaderboard_posts, start=1):
            reaction_value = leaderboard_reactions.get(post.id)
            try:
                typed_reaction = ReactionType(reaction_value) if reaction_value else None
            except ValueError:
                typed_reaction = None
            asset_type_value = _enum_value(post.asset_type)
            try:
                typed_asset_type = AssetType(asset_type_value)
            except ValueError:
                typed_asset_type = AssetType.dashboard

            current_popular = _popular_score(current_metrics.get(post.id, {}))
            previous_popular = _popular_score(previous_metrics.get(post.id, {}))
            trend_delta = current_popular - previous_popular

            if previous_popular == 0 and current_popular > 0:
                trend = FeedLeaderboardTrend.new
            elif trend_delta > 0:
                trend = FeedLeaderboardTrend.up
            elif trend_delta < 0:
                trend = FeedLeaderboardTrend.down
            else:
                trend = FeedLeaderboardTrend.stable

            leaderboard.append(
                FeedLeaderboardItem(
                    id=f"leaderboard-{post.id}",
                    rank=index,
                    postId=str(post.id),
                    assetType=typed_asset_type,
                    title=post.title or "Untitled insight",
                    creator=self._to_author(leaderboard_users.get(post.author_id), post.author_id),
                    thumbnailType=self._preview_payload(post).get("previewType"),
                    categoryTag=(post.tags[0] if post.tags else None),
                    popularityCount=_leaderboard_score(post, sort_by),
                    voteCount=int(post.reaction_count or 0),
                    viewCount=int(post.view_count or 0),
                    commentCount=int(post.comment_count or 0),
                    saveCount=int(post.save_count or 0),
                    shareCount=int(post.share_count or 0),
                    engagementScore=_leaderboard_score(post, LeaderboardSortBy.popular),
                    trend=trend,
                    trendDelta=trend_delta,
                    userInteraction=FeedUserInteraction(
                        reaction=typed_reaction,
                        isBookmarked=post.id in leaderboard_bookmarks,
                        isFollowingAuthor=bool(
                            post.author_id
                            and post.author_id in followed_authors
                        ),
                    ),
                )
            )

        contributor_stats: Dict[UUID, Dict[str, int]] = {}
        for post in filtered_posts:
            if not post.author_id:
                continue
            stats = contributor_stats.setdefault(
                post.author_id,
                {"contributionCount": 0, "engagementScore": 0},
            )
            stats["contributionCount"] += 1
            stats["engagementScore"] += _leaderboard_score(post, LeaderboardSortBy.popular)

        sorted_contributors = sorted(
            contributor_stats.items(),
            key=lambda item: (
                item[1]["engagementScore"],
                item[1]["contributionCount"],
            ),
            reverse=True,
        )[:5]
        contributor_users = await self._load_users(author_id for author_id, _ in sorted_contributors)
        top_contributors = [
            FeedTopContributor(
                id=str(author_id),
                author=self._to_author(contributor_users.get(author_id), author_id),
                contributionCount=stats["contributionCount"],
                engagementScore=stats["engagementScore"],
            )
            for author_id, stats in sorted_contributors
        ]

        collections: List[FeedSidebarCollection] = []
        if user_id:
            saved_count = int(
                await self.db.scalar(
                    select(func.count(func.distinct(FeedInteraction.post_id))).where(
                        FeedInteraction.user_id == user_id,
                        FeedInteraction.type == "save",
                    )
                )
                or 0
            )
            commented_count = int(
                await self.db.scalar(
                    select(func.count(func.distinct(FeedCommentModel.post_id))).where(
                        FeedCommentModel.user_id == user_id,
                    )
                )
                or 0
            )
            collections.append(
                FeedSidebarCollection(
                    id="saved-items",
                    name="Saved Items",
                    count=saved_count,
                    color="#7c3aed",
                )
            )
            collections.append(
                FeedSidebarCollection(
                    id="commented-items",
                    name="Commented Items",
                    count=commented_count,
                    color="#0ea5e9",
                )
            )
            # User-owned feed collections (CRUD via /api/feed/collections)
            owned = (
                await self.db.execute(
                    select(FeedCollection)
                    .where(FeedCollection.owner_id == user_id)
                    .order_by(FeedCollection.updated_at.desc())
                    .limit(50)
                )
            ).scalars().all()
            if owned:
                owned_ids = [c.id for c in owned]
                count_rows = (
                    await self.db.execute(
                        select(
                            FeedCollectionItemModel.collection_id,
                            func.count(FeedCollectionItemModel.id),
                        )
                        .where(FeedCollectionItemModel.collection_id.in_(owned_ids))
                        .group_by(FeedCollectionItemModel.collection_id)
                    )
                ).all()
                count_map = {row[0]: int(row[1] or 0) for row in count_rows}
                for coll in owned:
                    collections.append(
                        FeedSidebarCollection(
                            id=str(coll.id),
                            name=coll.name,
                            count=count_map.get(coll.id, 0),
                            color="#14b8a6",
                        )
                    )

        event_filters: List[Any] = []
        if organization_id:
            event_filters.append(
                or_(FeedEvent.organization_id == organization_id, FeedEvent.organization_id.is_(None))
            )
        if project_id and scope == FeedScope.project:
            event_filters.append(FeedEvent.project_id == project_id)

        activity_stmt = select(FeedEvent)
        if event_filters:
            activity_stmt = activity_stmt.where(and_(*event_filters))
        activity_stmt = activity_stmt.order_by(FeedEvent.created_at.desc()).limit(6)

        activity_result = await self.db.execute(activity_stmt)
        activity_rows = activity_result.scalars().all()

        actor_map = await self._load_users(row.actor_id for row in activity_rows if row.actor_id)

        post_map: Dict[UUID, FeedPost] = {}
        if activity_rows:
            post_ids = {row.post_id for row in activity_rows if row.post_id}
            if post_ids:
                post_result = await self.db.execute(select(FeedPost).where(FeedPost.id.in_(list(post_ids))))
                for post in post_result.scalars().all():
                    post_map[post.id] = post

        activity: List[FeedSidebarActivity] = []
        for row in activity_rows:
            post = post_map.get(row.post_id)
            title = post.title if post and post.title else "Feed activity"
            asset_type_value = _enum_value(post.asset_type) if post else AssetType.dashboard.value
            try:
                typed_asset = AssetType(asset_type_value)
            except ValueError:
                typed_asset = AssetType.dashboard

            activity.append(
                FeedSidebarActivity(
                    id=str(row.id),
                    postId=str(row.post_id) if row.post_id else None,
                    actor=self._to_author(actor_map.get(row.actor_id), row.actor_id),
                    action=_enum_value(row.type),
                    assetType=typed_asset,
                    title=title,
                    time=_time_ago(row.created_at),
                )
            )

        recommended: List[FeedRecommendedItem] = []
        if user_id and posts:
            followed_ids: set[UUID] = set()
            follow_result = await self.db.execute(
                select(FeedAuthorFollow.following_id).where(FeedAuthorFollow.follower_id == user_id)
            )
            followed_ids = {row[0] for row in follow_result.all() if row[0]}

            saved_tags: set[str] = set()
            saved_posts_result = await self.db.execute(
                select(FeedPost.tags)
                .join(FeedInteraction, FeedInteraction.post_id == FeedPost.id)
                .where(
                    FeedInteraction.user_id == user_id,
                    FeedInteraction.type == "save",
                )
            )
            for tag_row in saved_posts_result.all():
                for tag in tag_row[0] or []:
                    if tag:
                        saved_tags.add(tag)

            org_boost = organization_id is not None

            def _recommend_score(post: FeedPost) -> tuple[int, str]:
                score = 0
                reasons: List[str] = []
                if post.author_id and post.author_id in followed_ids:
                    score += 40
                    reasons.append("From someone you follow")
                post_tags = set(post.tags or [])
                overlap = post_tags & saved_tags
                if overlap:
                    score += 20 + min(10, len(overlap) * 5)
                    reasons.append("Matches your interests")
                engagement = (
                    int(post.view_count or 0)
                    + int(post.reaction_count or 0) * 2
                    + int(post.comment_count or 0) * 2
                    + int(post.save_count or 0) * 3
                )
                score += min(30, engagement // 5)
                if engagement > 10:
                    reasons.append("Trending in your network")
                if org_boost and post.organization_id == organization_id:
                    score += 15
                    reasons.append("From your organization")
                reason = reasons[0] if reasons else "Recommended for you"
                return score, reason

            scored_posts = sorted(
                [post for post in posts if post.id],
                key=lambda post: (_recommend_score(post)[0], post.published_at or post.created_at),
                reverse=True,
            )
            author_map = await self._load_users(post.author_id for post in scored_posts[:6] if post.author_id)
            for post in scored_posts[:6]:
                score, reason = _recommend_score(post)
                if score <= 0:
                    continue
                asset_type_value = _enum_value(post.asset_type)
                try:
                    typed_asset = AssetType(asset_type_value)
                except ValueError:
                    typed_asset = AssetType.dashboard
                recommended.append(
                    FeedRecommendedItem(
                        id=str(post.id),
                        postId=str(post.id),
                        assetType=typed_asset,
                        title=post.title or "Untitled",
                        creator=self._to_author(author_map.get(post.author_id), post.author_id),
                        reason=reason,
                        score=score,
                    )
                )

        return FeedSidebarResponse(
            leaderboard=leaderboard,
            topContributors=top_contributors,
            recommended=recommended,
            trendingTags=trending_tags,
            collections=collections,
            activity=activity,
        )

    @staticmethod
    def _collection_summary(
        collection: FeedCollection,
        *,
        item_count: int,
    ) -> FeedCollectionSummary:
        return FeedCollectionSummary(
            id=str(collection.id),
            name=collection.name,
            description=collection.description,
            isPublic=bool(collection.is_public),
            itemCount=item_count,
            organizationId=str(collection.organization_id) if collection.organization_id else None,
            projectId=str(collection.project_id) if collection.project_id else None,
            createdAt=_to_iso(collection.created_at),
            updatedAt=_to_iso(collection.updated_at),
        )

    async def get_collections(
        self,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionListResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._ensure_user_row(user_id, user_payload)

        result = await self.db.execute(
            select(FeedCollection)
            .where(FeedCollection.owner_id == user_id)
            .order_by(FeedCollection.created_at.desc())
        )
        collections = result.scalars().all()

        collection_ids = [collection.id for collection in collections]
        counts: Dict[UUID, int] = {}
        if collection_ids:
            count_result = await self.db.execute(
                select(FeedCollectionItemModel.collection_id, func.count())
                .where(FeedCollectionItemModel.collection_id.in_(collection_ids))
                .group_by(FeedCollectionItemModel.collection_id)
            )
            counts = {row[0]: int(row[1]) for row in count_result.all() if row[0]}

        summaries = [
            self._collection_summary(collection, item_count=counts.get(collection.id, 0))
            for collection in collections
        ]

        return FeedCollectionListResponse(collections=summaries)

    async def get_collection_detail(
        self,
        collection_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionDetail:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

        if not user_id:
            if not collection.is_public:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        else:
            await self._ensure_user_row(user_id, user_payload)
            if collection.owner_id != user_id and not collection.is_public:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        items_result = await self.db.execute(
            select(FeedCollectionItemModel)
            .where(FeedCollectionItemModel.collection_id == collection.id)
            .order_by(FeedCollectionItemModel.created_at.asc())
        )
        items = items_result.scalars().all()
        post_ids = [item.post_id for item in items if item.post_id]

        posts: List[FeedPost] = []
        if post_ids:
            post_filters: List[Any] = [FeedPost.id.in_(post_ids)]
            if collection.organization_id:
                post_filters.append(FeedPost.organization_id == collection.organization_id)
            if collection.project_id:
                post_filters.append(FeedPost.project_id == collection.project_id)

            if user_id:
                approval_filter = or_(
                    FeedPost.status == PublicationStatus.approved.value,
                    FeedPost.author_id == user_id,
                )
                org_ids_stmt = (
                    select(UserRole.organization_id)
                    .where(
                        UserRole.user_id == user_id,
                        UserRole.organization_id.isnot(None),
                        UserRole.is_active.is_(True),
                        UserRole.is_deleted.is_(False),
                    )
                )
                project_ids_stmt = (
                    select(UserRole.project_id)
                    .where(
                        UserRole.user_id == user_id,
                        UserRole.project_id.isnot(None),
                        UserRole.is_active.is_(True),
                        UserRole.is_deleted.is_(False),
                    )
                )
                accessible_filters = [
                    FeedPost.visibility == FeedVisibility.public.value,
                    and_(
                        FeedPost.organization_id.in_(org_ids_stmt),
                        FeedPost.visibility == FeedVisibility.organization.value,
                    ),
                    and_(
                        FeedPost.project_id.in_(project_ids_stmt),
                        FeedPost.visibility == FeedVisibility.project.value,
                    ),
                    and_(
                        FeedPost.author_id == user_id,
                        FeedPost.visibility == FeedVisibility.private.value,
                    ),
                ]
                post_filters.extend([approval_filter, or_(*accessible_filters)])
            else:
                post_filters.extend(
                    [
                        FeedPost.status == PublicationStatus.approved.value,
                        FeedPost.visibility == FeedVisibility.public.value,
                        FeedPost.requires_login.is_(False),
                        FeedPost.public_access_level == "results_only",
                    ]
                )

            post_result = await self.db.execute(select(FeedPost).where(and_(*post_filters)))
            posts = post_result.scalars().all()

        post_map = {post.id: post for post in posts}
        users = await self._load_users(post.author_id for post in posts if post.author_id)
        reactions = await self._load_user_reactions(user_id, posts)
        bookmarks = await self._load_user_bookmarks(user_id, posts)
        followed_authors = await self._load_followed_authors(user_id, posts)
        comments = await self._load_recent_comments(posts, viewer_id=user_id)

        serialized_items: List[FeedCollectionItem] = []
        for item in items:
            post = post_map.get(item.post_id)
            if not post:
                continue
            feed_item = self._build_item_response(
                post=post,
                users=users,
                reactions=reactions,
                bookmarks=bookmarks,
                comments=comments,
                followed_authors=followed_authors,
            )
            serialized_items.append(
                FeedCollectionItem(
                    id=str(item.id),
                    postId=str(item.post_id),
                    note=item.note,
                    createdAt=_to_iso(item.created_at),
                    post=feed_item,
                )
            )

        item_count = len(items) if user_id and collection.owner_id == user_id else len(serialized_items)

        summary = self._collection_summary(collection, item_count=item_count)
        return FeedCollectionDetail(
            **summary.dict(),
            items=serialized_items,
        )

    async def get_approval_queue(
        self,
        *,
        user_payload: Optional[Dict[str, Any]],
        organization_id: Optional[UUID],
        project_id: Optional[UUID],
        limit: int,
        offset: int,
    ) -> ApprovalQueueResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._ensure_user_row(user_id, user_payload)

        if not is_ee_enabled():
            return ApprovalQueueResponse(items=[], total=0, limit=limit, offset=offset)

        role_rows = await self.db.execute(
            select(UserRole.organization_id, UserRole.project_id, Role.name)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        org_owner_ids: Set[UUID] = set()
        org_admin_ids: Set[UUID] = set()
        project_approver_ids: Set[UUID] = set()

        for org_id, proj_id, role_name in role_rows.all():
            if role_name == "org_owner":
                if org_id:
                    org_owner_ids.add(org_id)
            if role_name == "org_admin":
                if org_id:
                    org_admin_ids.add(org_id)
            if role_name in ("project_owner", "project_editor"):
                if proj_id:
                    project_approver_ids.add(proj_id)

        if organization_id and organization_id not in (org_owner_ids | org_admin_ids):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization approval access required")
        if project_id and project_id not in project_approver_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project approval access required")

        approval_filters: List[Any] = [FeedPost.status == PublicationStatus.pending.value]
        visibility_filters: List[Any] = []

        org_scope_ids = {organization_id} if organization_id else (org_owner_ids | org_admin_ids)
        project_scope_ids = {project_id} if project_id else project_approver_ids

        if org_scope_ids:
            visibility_filters.append(
                and_(
                    FeedPost.visibility == FeedVisibility.organization.value,
                    FeedPost.organization_id.in_(list(org_scope_ids)),
                )
            )

        if project_scope_ids:
            visibility_filters.append(
                and_(
                    FeedPost.visibility == FeedVisibility.project.value,
                    FeedPost.project_id.in_(list(project_scope_ids)),
                )
            )

        if org_owner_ids:
            public_scope_ids = {organization_id} if organization_id else org_owner_ids
            visibility_filters.append(
                and_(
                    FeedPost.visibility == FeedVisibility.public.value,
                    FeedPost.organization_id.in_(list(public_scope_ids)),
                )
            )

        if not visibility_filters:
            return ApprovalQueueResponse(items=[], total=0, limit=limit, offset=offset)

        approval_filters.append(or_(*visibility_filters))

        base_stmt = select(FeedPost).where(and_(*approval_filters))
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int(await self.db.scalar(count_stmt) or 0)

        stmt = (
            base_stmt.order_by(
                func.coalesce(FeedPost.updated_at, FeedPost.created_at).desc()
            )
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        posts = result.scalars().all()

        users = await self._load_users(post.author_id for post in posts if post.author_id)
        reactions = await self._load_user_reactions(user_id, posts)
        bookmarks = await self._load_user_bookmarks(user_id, posts)
        followed_authors = await self._load_followed_authors(user_id, posts)
        comments = await self._load_recent_comments(posts, viewer_id=user_id)

        queue_items: List[ApprovalQueueItem] = []
        for post in posts:
            visibility_value = _enum_value(post.visibility)
            try:
                typed_visibility = FeedVisibility(visibility_value)
            except ValueError:
                typed_visibility = FeedVisibility.private

            status_value = _enum_value(post.status)
            try:
                typed_status = PublicationStatus(status_value)
            except ValueError:
                typed_status = PublicationStatus.pending

            feed_item = self._build_item_response(
                post=post,
                users=users,
                reactions=reactions,
                bookmarks=bookmarks,
                comments=comments,
                followed_authors=followed_authors,
            )
            queue_items.append(
                ApprovalQueueItem(
                    id=str(post.id),
                    item=feed_item,
                    submittedAt=_to_iso(post.last_activity_at or post.updated_at or post.created_at),
                    visibility=typed_visibility,
                    status=typed_status,
                    organizationId=str(post.organization_id) if post.organization_id else None,
                    projectId=str(post.project_id) if post.project_id else None,
                    rejectionReason=post.rejection_reason,
                )
            )

        return ApprovalQueueResponse(items=queue_items, total=total, limit=limit, offset=offset)

    async def get_notifications(
        self,
        *,
        user_payload: Optional[Dict[str, Any]],
        limit: int,
        offset: int,
        unread_only: bool,
    ) -> NotificationResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._ensure_user_row(user_id, user_payload)

        filters: List[Any] = [FeedNotification.recipient_id == user_id]
        if unread_only:
            filters.append(FeedNotification.is_read.is_(False))

        base_stmt = select(FeedNotification).where(and_(*filters))
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int(await self.db.scalar(count_stmt) or 0)

        stmt = (
            base_stmt.order_by(FeedNotification.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        notifications = result.scalars().all()

        actor_map = await self._load_users(
            notification.actor_id for notification in notifications if notification.actor_id
        )

        items: List[NotificationItem] = []
        for notification in notifications:
            items.append(
                NotificationItem(
                    id=str(notification.id),
                    type=str(notification.type),
                    actor=self._to_author(actor_map.get(notification.actor_id), notification.actor_id)
                    if notification.actor_id else None,
                    postId=str(notification.post_id) if notification.post_id else None,
                    commentId=str(notification.comment_id) if notification.comment_id else None,
                    metadata=notification.notification_metadata or None,
                    isRead=bool(notification.is_read),
                    createdAt=_to_iso(notification.created_at),
                )
            )

        return NotificationResponse(items=items, total=total, limit=limit, offset=offset)

    async def get_activity_feed(
        self,
        *,
        user_payload: Optional[Dict[str, Any]],
        organization_id: Optional[UUID],
        project_id: Optional[UUID],
        limit: int,
        offset: int,
    ) -> ActivityFeedResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)

        filters: List[Any] = []
        if organization_id:
            filters.append(
                or_(FeedEvent.organization_id == organization_id, FeedEvent.organization_id.is_(None))
            )
        if project_id:
            filters.append(FeedEvent.project_id == project_id)

        base_stmt = select(FeedEvent)
        if filters:
            base_stmt = base_stmt.where(and_(*filters))
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int(await self.db.scalar(count_stmt) or 0)

        stmt = (
            base_stmt.order_by(FeedEvent.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        events = result.scalars().all()

        actor_map = await self._load_users(row.actor_id for row in events if row.actor_id)
        post_ids = {row.post_id for row in events if row.post_id}
        post_map: Dict[UUID, FeedPost] = {}
        if post_ids:
            post_result = await self.db.execute(select(FeedPost).where(FeedPost.id.in_(list(post_ids))))
            for post in post_result.scalars().all():
                post_map[post.id] = post

        items: List[ActivityFeedItem] = []
        for row in events:
            post = post_map.get(row.post_id)
            title = post.title if post and post.title else "Feed activity"
            asset_type_value = _enum_value(post.asset_type) if post else AssetType.dashboard.value
            try:
                typed_asset = AssetType(asset_type_value)
            except ValueError:
                typed_asset = AssetType.dashboard

            items.append(
                ActivityFeedItem(
                    id=str(row.id),
                    actor=self._to_author(actor_map.get(row.actor_id), row.actor_id),
                    action=_enum_value(row.type),
                    assetType=typed_asset,
                    title=title,
                    time=_time_ago(row.created_at),
                    postId=str(row.post_id) if row.post_id else None,
                    metadata=row.event_metadata,
                )
            )

        return ActivityFeedResponse(items=items, total=total, limit=limit, offset=offset)

    async def get_trending_feed(
        self,
        *,
        scope: FeedScope,
        tags: Optional[List[str]],
        author_id: Optional[str],
        asset_type: Optional[AssetType],
        time_window_days: Optional[int],
        limit: int,
        offset: int,
        user_payload: Optional[Dict[str, Any]],
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
    ) -> FeedResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)

        filters: List[Any] = []
        if user_id:
            filters.append(
                or_(
                    FeedPost.status == PublicationStatus.approved.value,
                    FeedPost.author_id == user_id,
                )
            )
        else:
            filters.append(FeedPost.status == PublicationStatus.approved.value)

        filters.extend(
            self._feed_scope_filters(
                scope, organization_id=organization_id, project_id=project_id, user_id=user_id
            )
        )

        if asset_type:
            filters.append(FeedPost.asset_type == asset_type.value)

        if tags:
            for tag in tags:
                clean_tag = tag.strip()
                if clean_tag:
                    filters.append(FeedPost.tags.any(clean_tag))

        if author_id:
            author_uuid = _safe_uuid(author_id)
            if author_uuid:
                filters.append(FeedPost.author_id == author_uuid)

        if time_window_days and time_window_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=time_window_days)
            filters.append(func.coalesce(FeedPost.published_at, FeedPost.created_at) >= cutoff)

        if scope == FeedScope.public and not user_id:
            filters.append(FeedPost.requires_login.is_(False))

        if scope == FeedScope.public:
            filters.append(FeedPost.public_access_level == "results_only")

        trending_score = (
            FeedPost.reaction_count * 2
            + FeedPost.comment_count * 2
            + FeedPost.save_count * 3
            + FeedPost.share_count * 2
            + FeedPost.view_count
        )
        base_stmt = select(FeedPost).where(and_(*filters))
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int(await self.db.scalar(count_stmt) or 0)

        stmt = (
            base_stmt.order_by(trending_score.desc(), func.coalesce(FeedPost.published_at, FeedPost.created_at).desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        posts = result.scalars().all()

        users = await self._load_users(post.author_id for post in posts if post.author_id)
        reactions = await self._load_user_reactions(user_id, posts)
        bookmarks = await self._load_user_bookmarks(user_id, posts)
        followed_authors = await self._load_followed_authors(user_id, posts)
        comments = await self._load_recent_comments(posts, viewer_id=user_id)

        items = [
            self._build_item_response(
                post=post,
                users=users,
                reactions=reactions,
                bookmarks=bookmarks,
                comments=comments,
                followed_authors=followed_authors,
            )
            for post in posts
        ]

        return FeedResponse(items=items, total=total, limit=limit, offset=offset)

    async def lookup_publication_by_asset(
        self,
        asset_type: AssetType,
        asset_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> PublicationLookupResponse:
        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._validate_publish_asset(asset_type, asset_id, user_id)

        post = await self.db.scalar(
            select(FeedPost)
            .where(
                FeedPost.asset_type == asset_type.value,
                FeedPost.asset_id == asset_id,
            )
            .order_by(func.coalesce(FeedPost.published_at, FeedPost.created_at).desc())
            .limit(1)
        )
        if not post:
            return PublicationLookupResponse(exists=False)

        visibility = _enum_value(post.visibility)
        return PublicationLookupResponse(
            exists=True,
            publication_id=str(post.id),
            title=post.title,
            published_at=post.published_at,
            snapshot_version=int(post.snapshot_version or 0),
            visibility=FeedVisibility(visibility) if visibility in FeedVisibility.__members__ else None,
        )

    async def get_public_author_profile(
        self,
        username: str,
        *,
        limit: int = 20,
        offset: int = 0,
        user_payload: Optional[Dict[str, Any]] = None,
    ) -> PublicAuthorProfileResponse:
        await self._seed_mock_data_if_empty()
        user_id = self.resolve_user_id(user_payload)
        await self._set_rls_context(user_id)

        clean = username.strip().lstrip("@").lower()
        if not clean:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found")

        user = await self.db.scalar(select(User).where(func.lower(User.username) == clean))
        if not user:
            user = await self.db.scalar(
                select(User).where(func.lower(User.email).like(f"{clean}@%"))
            )
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found")

        author_id = user.id
        public_filters = and_(
            FeedPost.author_id == author_id,
            FeedPost.visibility == FeedVisibility.public.value,
            FeedPost.status == PublicationStatus.approved.value,
            FeedPost.requires_login.is_(False),
            FeedPost.public_access_level == "results_only",
        )

        post_count = int(await self.db.scalar(select(func.count()).select_from(FeedPost).where(public_filters)) or 0)
        total_views = int(
            await self.db.scalar(
                select(func.coalesce(func.sum(FeedPost.view_count), 0)).where(public_filters)
            )
            or 0
        )
        follower_count = int(
            await self.db.scalar(
                select(func.count()).select_from(FeedAuthorFollow).where(
                    FeedAuthorFollow.following_id == author_id
                )
            )
            or 0
        )

        stmt = select(FeedPost).where(public_filters)
        feed = await self._fetch_feed_response(stmt, FeedSort.recent, limit, offset, user_id)

        is_following = False
        if user_id and author_id != user_id:
            follow_row = await self.db.scalar(
                select(FeedAuthorFollow.id).where(
                    FeedAuthorFollow.follower_id == user_id,
                    FeedAuthorFollow.following_id == author_id,
                )
            )
            is_following = follow_row is not None

        return PublicAuthorProfileResponse(
            author=self._to_author(user, author_id),
            stats=PublicAuthorStats(
                post_count=post_count,
                total_views=total_views,
                follower_count=follower_count,
            ),
            items=feed.items,
            total=feed.total,
            limit=limit,
            offset=offset,
            isFollowing=is_following,
        )

    async def get_digest_preview(self, *, period_days: int = 7, limit: int = 10) -> DigestPreviewResponse:
        await self._seed_mock_data_if_empty()
        await self._set_rls_context(None)

        period_days = max(1, min(period_days, 30))
        limit = max(1, min(limit, 20))
        cutoff = datetime.now(timezone.utc) - timedelta(days=period_days)
        trending_score = (
            FeedPost.view_count
            + FeedPost.reaction_count * 2
            + FeedPost.comment_count
            + FeedPost.save_count * 3
        )

        stmt = (
            select(FeedPost)
            .where(
                FeedPost.visibility == FeedVisibility.public.value,
                FeedPost.status == PublicationStatus.approved.value,
                FeedPost.requires_login.is_(False),
                FeedPost.public_access_level == "results_only",
                func.coalesce(FeedPost.published_at, FeedPost.created_at) >= cutoff,
            )
            .order_by(trending_score.desc(), func.coalesce(FeedPost.published_at, FeedPost.created_at).desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        posts = result.scalars().all()

        items = [
            DigestPreviewItem(
                id=str(post.id),
                title=post.title or "Untitled insight",
                description=post.description,
                view_count=int(post.view_count or 0),
                reaction_count=int(post.reaction_count or 0),
                published_at=post.published_at,
            )
            for post in posts
        ]
        return DigestPreviewResponse(items=items, period_days=period_days)

    async def get_public_leaderboard(
        self,
        *,
        time_range: LeaderboardTimeRange = LeaderboardTimeRange.week,
        sort_by: LeaderboardSortBy = LeaderboardSortBy.popular,
        limit: int = 8,
    ) -> PublicLeaderboardResponse:
        sidebar = await self.get_sidebar_data(
            user_payload=None,
            scope=FeedScope.public,
            time_range=time_range,
            sort_by=sort_by,
            leaderboard_limit=max(3, min(limit, 20)),
        )
        return PublicLeaderboardResponse(
            items=sidebar.leaderboard[:limit],
            timeRange=time_range,
        )
