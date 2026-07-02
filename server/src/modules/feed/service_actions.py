"""Feed service write/mutation helpers."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence
from uuid import NAMESPACE_DNS, UUID, uuid5

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
try:
    from src.modules.authentication.rbac.models import Role, UserRole
except ImportError:
    Role = None  # type: ignore
    UserRole = None  # type: ignore
from src.modules.charts.models import Chart
from src.modules.dashboards.models import Dashboard
from src.modules.data.models import DataQuery
from src.modules.feed.models import FeedAuthorFollow, FeedCollection, FeedCollectionItem as FeedCollectionItemModel, FeedComment as FeedCommentModel, FeedCommentReaction, FeedEvent, FeedInteraction, FeedNotification, FeedPost, FeedShare, FeedSnapshot, FeedView, FeedDigestSubscription
from src.modules.user.models import User
from src.modules.feed.schemas import (
    AddCommentRequest,
    AddCommentResponse,
    AddCollectionItemRequest,
    ApprovalDecisionRequest,
    ApprovalDecisionResponse,
    AssetType,
    CreateCollectionRequest,
    DeleteItemResponse,
    DeleteCollectionResponse,
    DeleteCommentResponse,
    FeedComment,
    FeedCollectionDetail,
    FeedCollectionItem,
    MarkNotificationReadResponse,
    PublicationStatus,
    PublicationMode,
    PublishAssetRequest,
    PublishAssetResponse,
    PublishFromChatRequest,
    FeedRenderMode,
    UpdateSnapshotRequest,
    ChatFeedDraftRequest,
    ChatFeedDraftResponse,
    ReactCommentRequest,
    ReactCommentResponse,
    ReactRequest,
    ReactResponse,
    ReactionType,
    FollowAuthorResponse,
    FeedVisibility,
    SaveResponse,
    ShareResponse,
    TrackViewRequest,
    TrackViewResponse,
    UpdateCommentRequest,
    UpdateCommentResponse,
    UpdateCollectionItemRequest,
    UpdateCollectionRequest,
)
from src.modules.feed.service_utils import _enum_value, _reaction_values, _sanitize_preview_metadata, _to_iso, _utcnow
from src.modules.feed.snapshot_utils import (
    build_snapshot_payload_from_preview,
    create_feed_snapshot,
    normalize_snapshot_payload,
)
from src.modules.feed.permissions import enforce_snapshot_update_owner


class FeedServiceActionMixin:
    db: AsyncSession

    async def _notification_recipient_exists(self, user_id: UUID) -> bool:
        exists = await self.db.scalar(select(User.id).where(User.id == user_id))
        return exists is not None

    async def _create_notification(
        self,
        *,
        recipient_id: Optional[UUID],
        actor_id: Optional[UUID],
        notification_type: str,
        post_id: Optional[UUID] = None,
        comment_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not recipient_id:
            return
        if actor_id and recipient_id == actor_id:
            return
        if not await self._notification_recipient_exists(recipient_id):
            return

        entry = FeedNotification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            post_id=post_id,
            comment_id=comment_id,
            type=notification_type,
            notification_metadata=metadata,
            is_read=False,
        )
        self.db.add(entry)

    async def _notify_followers_of_publish(self, post: FeedPost) -> None:
        if not post.author_id:
            return
        if _enum_value(post.status) != PublicationStatus.approved.value:
            return

        follower_rows = await self.db.scalars(
            select(FeedAuthorFollow.follower_id).where(
                FeedAuthorFollow.following_id == post.author_id
            )
        )
        for follower_id in follower_rows.all():
            if not follower_id:
                continue
            await self._create_notification(
                recipient_id=follower_id,
                actor_id=post.author_id,
                notification_type="publish",
                post_id=post.id,
                metadata={"title": post.title},
            )

    async def _resolve_referrer_user_id(self, referral_code: Optional[str]) -> Optional[UUID]:
        clean = (referral_code or "").strip().lstrip("@").lower()
        if not clean:
            return None
        user = await self.db.scalar(select(User).where(func.lower(User.username) == clean))
        if user:
            return user.id
        user = await self.db.scalar(select(User).where(func.lower(User.email).like(f"{clean}@%")))
        return user.id if user else None

    async def _get_approver_ids(self, post: FeedPost) -> List[UUID]:
        if not is_ee_enabled() or Role is None or UserRole is None:
            return []

        visibility = _enum_value(post.visibility)

        if visibility == "public":
            role_names = ["org_owner"]
            org_id = post.organization_id
            if not org_id:
                return []
            stmt = (
                select(UserRole.user_id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.organization_id == org_id,
                    Role.name.in_(role_names),
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            )
        elif visibility == "organization":
            role_names = ["org_owner", "org_admin"]
            org_id = post.organization_id
            if not org_id:
                return []
            stmt = (
                select(UserRole.user_id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.organization_id == org_id,
                    Role.name.in_(role_names),
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            )
        elif visibility == "project":
            role_names = ["project_owner", "project_editor"]
            project_id = post.project_id
            if not project_id:
                return []
            stmt = (
                select(UserRole.user_id)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.project_id == project_id,
                    Role.name.in_(role_names),
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            )
        else:
            return []

        result = await self.db.execute(stmt)
        return [row[0] for row in result.all() if row[0]]

    async def _serialize_collection_item(
        self,
        item: FeedCollectionItemModel,
        *,
        user_id: Optional[UUID],
    ) -> FeedCollectionItem:
        post = await self.db.scalar(select(FeedPost).where(FeedPost.id == item.post_id))
        feed_item = None
        if post:
            users = await self._load_users([post.author_id] if post.author_id else [])
            reactions = await self._load_user_reactions(user_id, [post])
            bookmarks = await self._load_user_bookmarks(user_id, [post])
            followed_authors = await self._load_followed_authors(user_id, [post])
            comments = await self._load_recent_comments([post], viewer_id=user_id)
            previews = await self._load_preview_payloads([post])
            feed_item = self._build_item_response(
                post=post,
                users=users,
                reactions=reactions,
                bookmarks=bookmarks,
                comments=comments,
                followed_authors=followed_authors,
                preview_payload=previews.get(post.id),
                viewer_id=user_id,
            )

        return FeedCollectionItem(
            id=str(item.id),
            postId=str(item.post_id),
            note=item.note,
            createdAt=_to_iso(item.created_at),
            post=feed_item,
        )

    async def _get_role_names(
        self,
        user_id: UUID,
        *,
        organization_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
    ) -> List[str]:
        if Role is None or UserRole is None:
            return []

        stmt = (
            select(Role.name)
            .join(UserRole, Role.id == UserRole.role_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
        )
        if organization_id:
            stmt = stmt.where(UserRole.organization_id == organization_id)
        if project_id:
            stmt = stmt.where(UserRole.project_id == project_id)

        result = await self.db.execute(stmt)
        return [row[0] for row in result.all() if row[0]]

    async def _assert_can_view_post(self, user_id: Optional[UUID], post: FeedPost) -> None:
        visibility = _enum_value(post.visibility)
        if visibility == "public":
            if _enum_value(post.public_access_level) != "results_only":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public access disabled")
            if post.requires_login and not user_id:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
            return

        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        if visibility == "private":
            if post.author_id != user_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private feed item")
            return

        if visibility == "organization":
            roles = await self._get_role_names(user_id, organization_id=post.organization_id)
            if not roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization access required")
            return

        if visibility == "project":
            roles = await self._get_role_names(user_id, project_id=post.project_id)
            if not roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access required")
            return

    async def _assert_can_approve_post(self, user_id: UUID, post: FeedPost) -> None:
        visibility = _enum_value(post.visibility)

        org_roles = await self._get_role_names(user_id, organization_id=post.organization_id)
        project_roles = await self._get_role_names(user_id, project_id=post.project_id)

        is_org_owner = "org_owner" in org_roles
        is_org_admin = "org_admin" in org_roles
        is_project_owner = "project_owner" in project_roles
        is_project_editor = "project_editor" in project_roles

        if visibility == "public":
            if not is_org_owner:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org owner approval required")
            return

        if visibility == "organization":
            if not (is_org_owner or is_org_admin):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org approval required")
            return

        if visibility == "project":
            if not (is_project_owner or is_project_editor):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project approval required")
            return

        if visibility == "private":
            if post.author_id != user_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private item approval denied")
            return

    async def _get_post_or_404(self, item_id: UUID) -> FeedPost:
        post = await self.db.scalar(select(FeedPost).where(FeedPost.id == item_id))
        if not post:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed item not found")
        return post

    async def _get_comment_or_404(self, post_id: UUID, comment_id: UUID) -> FeedCommentModel:
        comment = await self.db.scalar(
            select(FeedCommentModel).where(
                FeedCommentModel.id == comment_id,
                FeedCommentModel.post_id == post_id,
            )
        )
        if not comment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
        return comment

    async def _collect_comment_thread_ids(self, root_id: UUID) -> List[UUID]:
        collected: List[UUID] = []
        pending: List[UUID] = [root_id]

        while pending:
            batch = pending
            pending = []
            collected.extend(batch)

            child_rows = await self.db.scalars(
                select(FeedCommentModel.id).where(FeedCommentModel.parent_id.in_(batch))
            )
            pending.extend(child_rows.all())

        return collected

    async def _log_event(
        self,
        *,
        actor_id: Optional[UUID],
        event_type: str,
        post: FeedPost,
        target_user_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not actor_id:
            return

        entry = FeedEvent(
            organization_id=post.organization_id,
            project_id=post.project_id,
            post_id=post.id,
            actor_id=actor_id,
            target_user_id=target_user_id,
            type=event_type,
            created_at=_utcnow(),
            event_metadata=metadata,
        )
        self.db.add(entry)

    async def _validate_publish_asset(
        self,
        asset_type: AssetType,
        asset_id: UUID,
        user_id: UUID,
    ) -> None:
        asset_value = asset_type.value
        if asset_value == AssetType.dashboard.value:
            row = await self.db.scalar(select(Dashboard.id).where(Dashboard.id == asset_id))
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
            return
        if asset_value == AssetType.chart.value:
            row = await self.db.scalar(select(Chart.id).where(Chart.id == asset_id))
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chart not found")
            return
        if asset_value == AssetType.query.value:
            result = await self.db.execute(
                select(DataQuery.id).where(DataQuery.user_id == str(user_id))
            )
            query_ids = [row[0] for row in result.all() if row[0]]
            matching = any(uuid5(NAMESPACE_DNS, f"query:{qid}") == asset_id for qid in query_ids)
            if not matching:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")
            return
        # insight assets are snapshots — no backing row required

    async def _apply_publication_snapshot(
        self,
        post: FeedPost,
        *,
        user_id: UUID,
        render_mode: FeedRenderMode,
        snapshot_payload: Optional[Dict[str, Any]],
        preview_metadata: Dict[str, Any],
        asset_type: str,
        title: str,
        description: Optional[str],
        thumbnail_url: Optional[str] = None,
    ) -> Optional[FeedSnapshot]:
        mode = render_mode.value if hasattr(render_mode, "value") else str(render_mode)
        if mode != FeedRenderMode.snapshot.value:
            post.render_mode = FeedRenderMode.live.value
            return None

        payload = normalize_snapshot_payload(snapshot_payload)
        if not payload:
            payload = build_snapshot_payload_from_preview(
                asset_type,
                preview_metadata,
                title=title,
                description=description,
            ) or {}

        if not payload:
            post.render_mode = FeedRenderMode.live.value
            return None

        return await create_feed_snapshot(
            self.db,
            post=post,
            payload=payload,
            created_by=user_id,
            thumbnail_url=thumbnail_url,
        )

    async def publish_asset(
        self,
        request: PublishAssetRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> PublishAssetResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        asset_id = request.asset_id
        if request.asset_type == AssetType.query and request.source_query_id:
            asset_id = uuid5(NAMESPACE_DNS, f"query:{request.source_query_id}")
        if not asset_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="asset_id is required")

        await self._validate_publish_asset(request.asset_type, asset_id, user_id)

        preview_metadata = _sanitize_preview_metadata(request.preview_metadata or {})
        if request.asset_type == AssetType.query and request.source_query_id:
            preview_metadata.setdefault("sourceQueryId", request.source_query_id)
        if request.thumbnail_url:
            preview_metadata["thumbnailUrl"] = request.thumbnail_url

        organization_id = request.organization_id
        project_id = request.project_id

        if project_id and not organization_id:
            from src.modules.project.models import Project

            organization_id = await self.db.scalar(
                select(Project.organization_id).where(Project.id == project_id)
            )

        org_roles = set(
            await self._get_role_names(user_id, organization_id=organization_id)
        ) if organization_id else set()
        project_roles = set(
            await self._get_role_names(user_id, project_id=project_id)
        ) if project_id else set()

        is_org_owner = "org_owner" in org_roles
        is_org_admin = "org_admin" in org_roles
        is_org_member = "org_member" in org_roles
        is_project_owner = "project_owner" in project_roles
        is_project_editor = "project_editor" in project_roles

        visibility_value = request.visibility.value

        if visibility_value == "organization":
            if organization_id and not (is_org_owner or is_org_admin or is_org_member):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient organization role")
        elif visibility_value == "project":
            if project_id and not (is_project_owner or is_project_editor):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient project role")
        elif visibility_value == "public":
            if organization_id and not (is_org_owner or is_org_admin or is_org_member):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient organization role")

        post = None
        if request.publication_mode != PublicationMode.create_new:
            if request.publication_id:
                post = await self.db.scalar(
                    select(FeedPost).where(FeedPost.id == request.publication_id)
                )
                if post and (
                    _enum_value(post.asset_type) != request.asset_type.value
                    or post.asset_id != asset_id
                ):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="publication_id does not match asset",
                    )
            else:
                post = await self.db.scalar(
                    select(FeedPost)
                    .where(
                        FeedPost.asset_type == request.asset_type.value,
                        FeedPost.asset_id == asset_id,
                    )
                    .order_by(func.coalesce(FeedPost.published_at, FeedPost.created_at).desc())
                    .limit(1)
                )

        requested_status = request.status.value
        status_value = requested_status
        now = _utcnow()
        approved_at = None
        approved_by = None
        rejected_at = None
        rejected_by = None
        published_at = None

        if requested_status == PublicationStatus.draft.value:
            status_value = PublicationStatus.draft.value
        elif requested_status == PublicationStatus.rejected.value:
            if not (is_org_owner or is_org_admin):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approval privilege required")
            status_value = PublicationStatus.rejected.value
        else:
            if visibility_value == "public":
                if not organization_id or is_org_owner:
                    status_value = PublicationStatus.approved.value
                else:
                    status_value = PublicationStatus.pending.value
            elif visibility_value == "organization":
                status_value = PublicationStatus.approved.value if (not organization_id or is_org_owner or is_org_admin) else PublicationStatus.pending.value
            elif visibility_value == "project":
                status_value = PublicationStatus.approved.value if (not project_id or is_project_owner or is_project_editor) else PublicationStatus.pending.value
            else:
                status_value = PublicationStatus.approved.value

        if status_value == PublicationStatus.approved.value:
            approved_at = now
            approved_by = user_id
            published_at = now
        elif status_value == PublicationStatus.rejected.value:
            rejected_at = now
            rejected_by = user_id

        public_access_level = request.public_access_level or "results_only"
        if visibility_value == "public":
            public_access_level = "results_only"

        featured = request.featured if (is_org_owner or is_org_admin) else False
        featured_until = request.featured_until if featured else None

        requires_login = request.requires_login
        if visibility_value != FeedVisibility.public.value:
            requires_login = True

        if not post:
            post = FeedPost(
                asset_type=request.asset_type.value,
                asset_id=asset_id,
                author_id=user_id,
                organization_id=organization_id,
                project_id=project_id,
                visibility=visibility_value,
                status=status_value,
                title=request.title,
                description=request.description,
                tags=request.tags,
                approved_by=approved_by,
                approved_at=approved_at,
                published_at=published_at,
                rejected_by=rejected_by,
                rejected_at=rejected_at,
                rejection_reason=request.rejection_reason,
                public_access_level=public_access_level,
                requires_login=requires_login,
                featured=featured,
                featured_until=featured_until,
                last_activity_at=published_at or now,
            )
            if preview_metadata:
                post.preview_metadata = preview_metadata
            self.db.add(post)
        else:
            post.author_id = user_id
            post.organization_id = organization_id
            post.project_id = project_id
            post.visibility = visibility_value
            post.status = status_value
            post.title = request.title
            post.description = request.description
            post.tags = request.tags
            post.approved_by = approved_by
            post.approved_at = approved_at
            post.published_at = published_at
            post.rejected_by = rejected_by
            post.rejected_at = rejected_at
            if status_value == PublicationStatus.rejected.value:
                post.rejection_reason = request.rejection_reason or post.rejection_reason
            post.public_access_level = public_access_level
            post.requires_login = requires_login
            post.featured = featured
            post.featured_until = featured_until
            post.last_activity_at = published_at or now
            if preview_metadata:
                post.preview_metadata = preview_metadata

        await self.db.flush()
        snapshot_row = await self._apply_publication_snapshot(
            post,
            user_id=user_id,
            render_mode=request.render_mode,
            snapshot_payload=request.snapshot_payload,
            preview_metadata=preview_metadata,
            asset_type=request.asset_type.value,
            title=request.title,
            description=request.description,
            thumbnail_url=request.thumbnail_url,
        )
        if status_value == PublicationStatus.pending.value:
            await self._log_event(
                actor_id=user_id,
                event_type="approval_requested",
                post=post,
                target_user_id=post.author_id,
                metadata={
                    "visibility": visibility_value,
                },
            )
            approver_ids = await self._get_approver_ids(post)
            for approver_id in approver_ids:
                await self._create_notification(
                    recipient_id=approver_id,
                    actor_id=user_id,
                    notification_type="approval",
                    post_id=post.id,
                    metadata={
                        "status": PublicationStatus.pending.value,
                        "visibility": visibility_value,
                    },
                )
        elif status_value == PublicationStatus.approved.value:
            await self._log_event(
                actor_id=user_id,
                event_type="publish",
                post=post,
                target_user_id=post.author_id,
                metadata={
                    "visibility": visibility_value,
                },
            )
            await self._notify_followers_of_publish(post)
        elif status_value == PublicationStatus.rejected.value:
            await self._log_event(
                actor_id=user_id,
                event_type="rejected",
                post=post,
                target_user_id=post.author_id,
                metadata={
                    "visibility": visibility_value,
                    "reason": request.rejection_reason,
                },
            )
        await self.db.commit()

        return PublishAssetResponse(
            success=True,
            publication_id=str(post.id),
            status=PublicationStatus(status_value),
            snapshot_version=int(post.snapshot_version or 0),
            render_mode=FeedRenderMode(_enum_value(post.render_mode) or FeedRenderMode.live.value),
        )

    async def update_publication_snapshot(
        self,
        post_id: UUID,
        request: UpdateSnapshotRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> PublishAssetResponse:
        post = await enforce_snapshot_update_owner(self.db, post_id, user_payload)
        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        preview_metadata = _sanitize_preview_metadata(request.preview_metadata or {})
        if request.thumbnail_url:
            preview_metadata["thumbnailUrl"] = request.thumbnail_url
        if request.title:
            post.title = request.title
        if request.description is not None:
            post.description = request.description
        if preview_metadata:
            post.preview_metadata = {**(post.preview_metadata or {}), **preview_metadata}

        previous_thumbnail_url = None
        if post.current_snapshot_id:
            previous_snapshot = await self.db.get(FeedSnapshot, post.current_snapshot_id)
            previous_thumbnail_url = getattr(previous_snapshot, "thumbnail_url", None)

        await create_feed_snapshot(
            self.db,
            post=post,
            payload=normalize_snapshot_payload(request.snapshot_payload),
            created_by=user_id,
            thumbnail_url=request.thumbnail_url or previous_thumbnail_url,
        )
        post.last_activity_at = _utcnow()
        await self.db.commit()

        return PublishAssetResponse(
            success=True,
            publication_id=str(post.id),
            status=PublicationStatus(_enum_value(post.status)),
            snapshot_version=int(post.snapshot_version or 0),
            render_mode=FeedRenderMode.snapshot,
        )

    async def save_chat_feed_draft(
        self,
        request: ChatFeedDraftRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> ChatFeedDraftResponse:
        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        from src.modules.feed.models import FeedChatDraft

        draft_row = await self.db.scalar(
            select(FeedChatDraft).where(
                FeedChatDraft.user_id == user_id,
                FeedChatDraft.conversation_id == request.conversation_id,
                FeedChatDraft.message_id == request.message_id,
            )
        )
        if draft_row:
            draft_row.draft = request.draft
            draft_row.updated_at = _utcnow()
        else:
            draft_row = FeedChatDraft(
                user_id=user_id,
                conversation_id=request.conversation_id,
                message_id=request.message_id,
                draft=request.draft,
            )
            self.db.add(draft_row)
        await self.db.commit()
        return ChatFeedDraftResponse(
            success=True,
            conversation_id=request.conversation_id,
            message_id=request.message_id,
            draft=request.draft,
        )

    async def get_chat_feed_draft(
        self,
        conversation_id: str,
        message_id: str,
        user_payload: Optional[Dict[str, Any]],
    ) -> ChatFeedDraftResponse:
        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        from src.modules.feed.models import FeedChatDraft

        draft_row = await self.db.scalar(
            select(FeedChatDraft).where(
                FeedChatDraft.user_id == user_id,
                FeedChatDraft.conversation_id == conversation_id,
                FeedChatDraft.message_id == message_id,
            )
        )
        draft = draft_row.draft if draft_row else {}
        return ChatFeedDraftResponse(
            success=True,
            conversation_id=conversation_id,
            message_id=message_id,
            draft=draft or {},
        )

    async def publish_from_chat(
        self,
        request: PublishFromChatRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> PublishAssetResponse:
        asset_id = uuid5(NAMESPACE_DNS, f"chat:{request.conversation_id}:{request.message_id}")
        preview_metadata = _sanitize_preview_metadata(request.preview_metadata or {})
        preview_metadata.setdefault("conversationId", str(request.conversation_id))
        preview_metadata.setdefault("messageId", str(request.message_id))
        if request.description and not preview_metadata.get("summary"):
            preview_metadata = {**preview_metadata, "summary": request.description}

        publish_request = PublishAssetRequest(
            asset_type=AssetType.insight,
            asset_id=asset_id,
            organization_id=request.organization_id,
            project_id=request.project_id,
            title=request.title,
            description=request.description,
            tags=request.tags,
            visibility=request.visibility,
            preview_metadata=preview_metadata,
            render_mode=request.render_mode,
            snapshot_payload=request.snapshot_payload,
            thumbnail_url=request.thumbnail_url,
            requires_login=request.requires_login,
            publication_mode=request.publication_mode,
        )
        response = await self.publish_asset(publish_request, user_payload)

        post = await self.db.scalar(select(FeedPost).where(FeedPost.id == UUID(response.publication_id)))
        if post and preview_metadata and not post.preview_metadata:
            post.preview_metadata = preview_metadata
            await self.db.commit()

        return response

    async def approve_publication(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> ApprovalDecisionResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        post = await self._get_post_or_404(item_id)
        if _enum_value(post.status) != PublicationStatus.pending.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Feed item is not pending")

        await self._assert_can_approve_post(user_id, post)

        now = _utcnow()
        previous_status = _enum_value(post.status)
        post.status = PublicationStatus.approved.value
        post.approved_at = now
        post.approved_by = user_id
        post.rejected_at = None
        post.rejected_by = None
        post.rejection_reason = None
        if not post.published_at:
            post.published_at = now
        post.last_activity_at = now
        if _enum_value(post.visibility) == "public":
            post.public_access_level = "results_only"

        await self._log_event(
            actor_id=user_id,
            event_type="approved",
            post=post,
            target_user_id=post.author_id,
            metadata={
                "previous_status": previous_status,
                "visibility": _enum_value(post.visibility),
                "decision": "approved",
            },
        )
        await self._create_notification(
            recipient_id=post.author_id,
            actor_id=user_id,
            notification_type="approval",
            post_id=post.id,
            metadata={
                "status": PublicationStatus.approved.value,
            },
        )
        await self._notify_followers_of_publish(post)

        await self.db.commit()

        return ApprovalDecisionResponse(
            success=True,
            status=PublicationStatus.approved,
            approvedAt=_to_iso(post.approved_at),
        )

    async def reject_publication(
        self,
        item_id: UUID,
        request: ApprovalDecisionRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> ApprovalDecisionResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        post = await self._get_post_or_404(item_id)
        if _enum_value(post.status) != PublicationStatus.pending.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Feed item is not pending")

        await self._assert_can_approve_post(user_id, post)

        reason = (request.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rejection reason is required")

        now = _utcnow()
        previous_status = _enum_value(post.status)
        post.status = PublicationStatus.rejected.value
        post.rejected_at = now
        post.rejected_by = user_id
        post.rejection_reason = reason
        post.last_activity_at = now

        await self._log_event(
            actor_id=user_id,
            event_type="rejected",
            post=post,
            target_user_id=post.author_id,
            metadata={
                "previous_status": previous_status,
                "visibility": _enum_value(post.visibility),
                "decision": "rejected",
                "reason": reason,
            },
        )
        await self._create_notification(
            recipient_id=post.author_id,
            actor_id=user_id,
            notification_type="approval",
            post_id=post.id,
            metadata={
                "status": PublicationStatus.rejected.value,
                "reason": reason,
            },
        )

        await self.db.commit()

        return ApprovalDecisionResponse(
            success=True,
            status=PublicationStatus.rejected,
            rejectedAt=_to_iso(post.rejected_at),
        )

    async def mark_notification_read(
        self,
        notification_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> MarkNotificationReadResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        notification = await self.db.scalar(
            select(FeedNotification).where(
                FeedNotification.id == notification_id,
                FeedNotification.recipient_id == user_id,
            )
        )
        if not notification:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

        notification.is_read = True
        notification.read_at = _utcnow()
        await self.db.commit()

        return MarkNotificationReadResponse(success=True)

    async def create_collection(
        self,
        request: CreateCollectionRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionDetail:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        organization_id = request.organization_id
        project_id = request.project_id
        if project_id and not organization_id:
            from src.modules.project.models import Project

            organization_id = await self.db.scalar(
                select(Project.organization_id).where(Project.id == project_id)
            )
            if not organization_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found")

        if organization_id:
            org_roles = await self._get_role_names(user_id, organization_id=organization_id)
            if not org_roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization access required")

        if project_id:
            project_roles = await self._get_role_names(user_id, project_id=project_id)
            if not project_roles:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project access required")

        collection = FeedCollection(
            owner_id=user_id,
            organization_id=organization_id,
            project_id=project_id,
            name=request.name.strip(),
            description=request.description,
            is_public=bool(request.is_public),
        )
        self.db.add(collection)
        await self.db.commit()

        return await self.get_collection_detail(collection.id, user_payload)

    async def update_collection(
        self,
        collection_id: UUID,
        request: UpdateCollectionRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionDetail:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        if collection.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        if request.name is not None:
            collection.name = request.name.strip()
        if request.description is not None:
            collection.description = request.description
        if request.is_public is not None:
            collection.is_public = bool(request.is_public)

        await self.db.commit()
        return await self.get_collection_detail(collection.id, user_payload)

    async def delete_collection(
        self,
        collection_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> DeleteCollectionResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        if collection.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        await self.db.execute(
            delete(FeedCollectionItemModel).where(FeedCollectionItemModel.collection_id == collection.id)
        )
        await self.db.execute(
            delete(FeedCollection).where(FeedCollection.id == collection.id)
        )
        await self.db.commit()

        return DeleteCollectionResponse(success=True)

    async def add_collection_item(
        self,
        collection_id: UUID,
        request: AddCollectionItemRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionItem:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        if collection.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        post = await self._get_post_or_404(request.post_id)
        await self._assert_can_view_post(user_id, post)

        if collection.organization_id and post.organization_id != collection.organization_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Post is outside collection scope")
        if collection.project_id and post.project_id != collection.project_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Post is outside collection scope")

        item = await self.db.scalar(
            select(FeedCollectionItemModel).where(
                FeedCollectionItemModel.collection_id == collection.id,
                FeedCollectionItemModel.post_id == post.id,
            )
        )
        if item:
            if request.note is not None:
                item.note = request.note
            await self.db.flush()
        else:
            item = FeedCollectionItemModel(
                collection_id=collection.id,
                post_id=post.id,
                note=request.note,
            )
            self.db.add(item)
            await self.db.flush()

        await self.db.commit()
        return await self._serialize_collection_item(item, user_id=user_id)

    async def update_collection_item(
        self,
        collection_id: UUID,
        item_id: UUID,
        request: UpdateCollectionItemRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> FeedCollectionItem:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        if collection.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        item = await self.db.scalar(
            select(FeedCollectionItemModel).where(
                FeedCollectionItemModel.id == item_id,
                FeedCollectionItemModel.collection_id == collection.id,
            )
        )
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection item not found")

        if request.note is not None:
            item.note = request.note
        await self.db.commit()

        return await self._serialize_collection_item(item, user_id=user_id)

    async def remove_collection_item(
        self,
        collection_id: UUID,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> DeleteCollectionResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        collection = await self.db.scalar(
            select(FeedCollection).where(FeedCollection.id == collection_id)
        )
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        if collection.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collection access denied")

        await self.db.execute(
            delete(FeedCollectionItemModel).where(
                FeedCollectionItemModel.id == item_id,
                FeedCollectionItemModel.collection_id == collection.id,
            )
        )
        await self.db.commit()

        return DeleteCollectionResponse(success=True)

    async def toggle_follow_author(
        self,
        author_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> FollowAuthorResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        if author_id == user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot follow yourself")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        author_exists = await self.db.scalar(select(User.id).where(User.id == author_id))
        if not author_exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found")

        existing = await self.db.scalar(
            select(FeedAuthorFollow).where(
                FeedAuthorFollow.follower_id == user_id,
                FeedAuthorFollow.following_id == author_id,
            )
        )

        is_following: bool
        if existing:
            await self.db.delete(existing)
            is_following = False
        else:
            self.db.add(
                FeedAuthorFollow(
                    follower_id=user_id,
                    following_id=author_id,
                )
            )
            is_following = True
            await self._create_notification(
                recipient_id=author_id,
                actor_id=user_id,
                notification_type="follow",
            )

        await self.db.commit()
        return FollowAuthorResponse(
            success=True,
            author_id=str(author_id),
            isFollowing=is_following,
        )

    async def delete_item(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> DeleteItemResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)

        if post.author_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the post author can delete this item")

        comment_ids_stmt = select(FeedCommentModel.id).where(FeedCommentModel.post_id == post.id)

        await self.db.execute(delete(FeedCollectionItemModel).where(FeedCollectionItemModel.post_id == post.id))
        await self.db.execute(delete(FeedInteraction).where(FeedInteraction.post_id == post.id))
        await self.db.execute(delete(FeedShare).where(FeedShare.post_id == post.id))
        await self.db.execute(delete(FeedView).where(FeedView.post_id == post.id))
        await self.db.execute(delete(FeedNotification).where(FeedNotification.post_id == post.id))
        await self.db.execute(delete(FeedEvent).where(FeedEvent.post_id == post.id))

        # Break self-referencing comment hierarchy before hard-delete.
        await self.db.execute(
            update(FeedCommentModel)
            .where(FeedCommentModel.post_id == post.id)
            .values(parent_id=None)
        )
        await self.db.execute(delete(FeedCommentReaction).where(FeedCommentReaction.comment_id.in_(comment_ids_stmt)))
        await self.db.execute(delete(FeedCommentModel).where(FeedCommentModel.post_id == post.id))

        await self.db.delete(post)
        await self.db.commit()
        return DeleteItemResponse(success=True)

    async def react_to_item(
        self,
        item_id: UUID,
        request: ReactRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> ReactResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        reaction_types = _reaction_values()
        existing_stmt = select(FeedInteraction).where(
            FeedInteraction.post_id == post.id,
            FeedInteraction.user_id == user_id,
            FeedInteraction.type.in_(reaction_types),
        )
        existing_result = await self.db.execute(existing_stmt)
        existing_reactions = existing_result.scalars().all()

        selected_reaction: Optional[ReactionType]
        if any(_enum_value(row.type) == request.reaction.value for row in existing_reactions):
            for row in existing_reactions:
                await self.db.delete(row)
            selected_reaction = None
        else:
            for row in existing_reactions:
                await self.db.delete(row)
            self.db.add(
                FeedInteraction(
                    post_id=post.id,
                    user_id=user_id,
                    type=request.reaction.value,
                )
            )
            selected_reaction = request.reaction

        await self.db.flush()

        count_stmt = select(func.count()).select_from(FeedInteraction).where(
            FeedInteraction.post_id == post.id,
            FeedInteraction.type.in_(reaction_types),
        )
        reaction_count = int(await self.db.scalar(count_stmt) or 0)

        post.reaction_count = reaction_count

        if selected_reaction:
            await self._log_event(
                actor_id=user_id,
                event_type="reaction",
                post=post,
                target_user_id=post.author_id,
                metadata={
                    "reaction": selected_reaction.value,
                },
            )
            await self._create_notification(
                recipient_id=post.author_id,
                actor_id=user_id,
                notification_type="reaction",
                post_id=post.id,
                metadata={
                    "reaction": selected_reaction.value,
                },
            )

        await self.db.commit()

        return ReactResponse(
            success=True,
            reaction=selected_reaction,
            reaction_count=reaction_count,
        )

    async def toggle_save_item(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> SaveResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        existing = await self.db.scalar(
            select(FeedInteraction).where(
                FeedInteraction.post_id == post.id,
                FeedInteraction.user_id == user_id,
                FeedInteraction.type == "save",
            )
        )

        is_bookmarked: bool
        if existing:
            await self.db.delete(existing)
            is_bookmarked = False
        else:
            self.db.add(
                FeedInteraction(
                    post_id=post.id,
                    user_id=user_id,
                    type="save",
                )
            )
            is_bookmarked = True

        await self.db.flush()

        bookmark_count = int(
            await self.db.scalar(
                select(func.count()).select_from(FeedInteraction).where(
                    FeedInteraction.post_id == post.id,
                    FeedInteraction.type == "save",
                )
            )
            or 0
        )
        post.save_count = bookmark_count

        if is_bookmarked:
            await self._log_event(
                actor_id=user_id,
                event_type="save",
                post=post,
                target_user_id=post.author_id,
            )

        await self.db.commit()

        return SaveResponse(
            success=True,
            isBookmarked=is_bookmarked,
            bookmark_count=bookmark_count,
        )

    async def share_item(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> ShareResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if user_id:
            await self._set_rls_context(user_id)
            await self._ensure_user_row(user_id, user_payload)
        else:
            await self._set_rls_context(None)

        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        self.db.add(
            FeedShare(
                post_id=post.id,
                user_id=user_id,
            )
        )

        post.share_count = int(post.share_count or 0) + 1
        await self._log_event(
            actor_id=user_id,
            event_type="share",
            post=post,
            target_user_id=post.author_id,
        )
        await self._create_notification(
            recipient_id=post.author_id,
            actor_id=user_id,
            notification_type="share",
            post_id=post.id,
        )
        await self.db.commit()

        share_link = f"/discover/{post.id}"
        if _enum_value(post.visibility) != FeedVisibility.public.value:
            share_link = f"/feed/{post.id}"

        return ShareResponse(
            success=True,
            share_count=int(post.share_count or 0),
            share_link=share_link,
        )

    async def add_comment(
        self,
        item_id: UUID,
        request: AddCommentRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> AddCommentResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        author = await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        content = request.content.strip()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment content is required")

        parent_comment_id = request.parent_comment_id
        parent_comment = None
        if parent_comment_id:
            parent_comment = await self.db.scalar(
                select(FeedCommentModel).where(
                    FeedCommentModel.id == parent_comment_id,
                    FeedCommentModel.post_id == post.id,
                )
            )
            if not parent_comment:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent comment not found")

        comment = FeedCommentModel(
            post_id=post.id,
            user_id=user_id,
            parent_id=parent_comment_id,
            content=content,
            mentions=request.mentioned_users or [],
        )
        self.db.add(comment)
        await self.db.flush()

        comment_count = int(
            await self.db.scalar(
                select(func.count())
                .select_from(FeedCommentModel)
                .where(
                    FeedCommentModel.post_id == post.id,
                    FeedCommentModel.is_deleted.is_(False),
                )
            )
            or 0
        )

        post.comment_count = comment_count
        post.last_activity_at = _utcnow()

        await self._log_event(
            actor_id=user_id,
            event_type="comment",
            post=post,
            target_user_id=post.author_id,
            metadata={
                "comment_id": str(comment.id),
            },
        )
        await self._create_notification(
            recipient_id=post.author_id,
            actor_id=user_id,
            notification_type="comment",
            post_id=post.id,
            comment_id=comment.id,
        )
        if parent_comment and parent_comment.user_id != post.author_id:
            await self._create_notification(
                recipient_id=parent_comment.user_id,
                actor_id=user_id,
                notification_type="comment",
                post_id=post.id,
                comment_id=comment.id,
                metadata={
                    "parent_comment_id": str(parent_comment.id),
                },
            )

        for mentioned_id in request.mentioned_users or []:
            await self._create_notification(
                recipient_id=mentioned_id,
                actor_id=user_id,
                notification_type="mention",
                post_id=post.id,
                comment_id=comment.id,
            )
            await self._log_event(
                actor_id=user_id,
                event_type="mention",
                post=post,
                target_user_id=mentioned_id,
                metadata={
                    "comment_id": str(comment.id),
                },
            )

        await self.db.commit()

        reaction_counts, user_reactions = await self._load_comment_reactions([comment.id], user_id)
        comment_reaction_map = reaction_counts.get(comment.id, {})

        return AddCommentResponse(
            success=True,
            comment=FeedComment(
                id=str(comment.id),
                author=self._to_author(author, user_id),
                content=comment.content,
                createdAt=_to_iso(comment.created_at),
                parentCommentId=str(comment.parent_id) if comment.parent_id else None,
                editedAt=None,
                isEdited=False,
                isPostAuthor=post.author_id == user_id,
                canEdit=True,
                replyCount=0,
                reactions=comment_reaction_map,
                reactionCount=sum(comment_reaction_map.values()),
                userReaction=user_reactions.get(comment.id),
                replies=[],
            ),
            comment_count=comment_count,
        )

    async def update_comment(
        self,
        item_id: UUID,
        comment_id: UUID,
        request: UpdateCommentRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> UpdateCommentResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)
        comment = await self._get_comment_or_404(post.id, comment_id)

        if comment.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own comment")

        if comment.is_deleted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment is deleted")

        updated_content = request.content.strip()
        if not updated_content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment content is required")

        comment.content = updated_content
        comment.mentions = request.mentioned_users or []
        comment.edited_at = _utcnow()
        await self.db.flush()

        author = await self.db.scalar(select(User).where(User.id == comment.user_id))
        reaction_counts, user_reactions = await self._load_comment_reactions([comment.id], user_id)
        comment_reaction_map = reaction_counts.get(comment.id, {})
        reply_count = int(
            await self.db.scalar(
                select(func.count())
                .select_from(FeedCommentModel)
                .where(
                    FeedCommentModel.parent_id == comment.id,
                    FeedCommentModel.is_deleted.is_(False),
                )
            )
            or 0
        )

        await self.db.commit()

        return UpdateCommentResponse(
            success=True,
            comment=FeedComment(
                id=str(comment.id),
                author=self._to_author(author, comment.user_id),
                content=comment.content,
                createdAt=_to_iso(comment.created_at),
                parentCommentId=str(comment.parent_id) if comment.parent_id else None,
                editedAt=_to_iso(comment.edited_at) if comment.edited_at else None,
                isEdited=comment.edited_at is not None,
                isPostAuthor=post.author_id == comment.user_id,
                canEdit=True,
                replyCount=reply_count,
                reactions=comment_reaction_map,
                reactionCount=sum(comment_reaction_map.values()),
                userReaction=user_reactions.get(comment.id),
                replies=[],
            ),
        )

    async def delete_comment(
        self,
        item_id: UUID,
        comment_id: UUID,
        user_payload: Optional[Dict[str, Any]],
    ) -> DeleteCommentResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)
        comment = await self._get_comment_or_404(post.id, comment_id)

        if comment.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own comment")

        comment_ids = await self._collect_comment_thread_ids(comment.id)

        if comment_ids:
            await self.db.execute(
                delete(FeedCommentReaction).where(FeedCommentReaction.comment_id.in_(comment_ids))
            )
            await self.db.execute(
                update(FeedCommentModel)
                .where(FeedCommentModel.id.in_(comment_ids))
                .values(
                    is_deleted=True,
                    deleted_at=_utcnow(),
                    deleted_by=user_id,
                    moderation_status="deleted",
                    content="[deleted]",
                )
            )
            await self.db.flush()

        comment_count = int(
            await self.db.scalar(
                select(func.count())
                .select_from(FeedCommentModel)
                .where(
                    FeedCommentModel.post_id == post.id,
                    FeedCommentModel.is_deleted.is_(False),
                )
            )
            or 0
        )
        post.comment_count = comment_count
        post.last_activity_at = _utcnow()

        await self.db.commit()

        return DeleteCommentResponse(
            success=True,
            comment_count=comment_count,
        )

    async def react_to_comment(
        self,
        item_id: UUID,
        comment_id: UUID,
        request: ReactCommentRequest,
        user_payload: Optional[Dict[str, Any]],
    ) -> ReactCommentResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)
        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)
        comment = await self._get_comment_or_404(post.id, comment_id)

        existing = await self.db.scalar(
            select(FeedCommentReaction).where(
                FeedCommentReaction.comment_id == comment.id,
                FeedCommentReaction.user_id == user_id,
            )
        )

        selected_reaction: Optional[ReactionType]
        if existing and _enum_value(existing.reaction) == request.reaction.value:
            await self.db.delete(existing)
            selected_reaction = None
        elif existing:
            existing.reaction = request.reaction.value
            selected_reaction = request.reaction
        else:
            self.db.add(
                FeedCommentReaction(
                    comment_id=comment.id,
                    user_id=user_id,
                    reaction=request.reaction.value,
                )
            )
            selected_reaction = request.reaction

        await self.db.flush()

        reaction_count = int(
            await self.db.scalar(
                select(func.count()).select_from(FeedCommentReaction).where(
                    FeedCommentReaction.comment_id == comment.id
                )
            )
            or 0
        )

        if selected_reaction:
            await self._log_event(
                actor_id=user_id,
                event_type="reaction",
                post=post,
                target_user_id=post.author_id,
                metadata={
                    "reaction": selected_reaction.value,
                    "comment_id": str(comment.id),
                },
            )
            await self._create_notification(
                recipient_id=comment.user_id,
                actor_id=user_id,
                notification_type="reaction",
                post_id=post.id,
                comment_id=comment.id,
                metadata={
                    "reaction": selected_reaction.value,
                },
            )

        await self.db.commit()

        return ReactCommentResponse(
            success=True,
            reaction=selected_reaction,
            reaction_count=reaction_count,
        )

    async def track_view(
        self,
        item_id: UUID,
        request: TrackViewRequest,
        user_payload: Optional[Dict[str, Any]],
        *,
        ip_address: Optional[str],
        user_agent: Optional[str],
        referrer: Optional[str],
    ) -> TrackViewResponse:
        await self._seed_mock_data_if_empty()

        user_id = self.resolve_user_id(user_payload)
        if user_id:
            await self._set_rls_context(user_id)
            await self._ensure_user_row(user_id, user_payload)
        else:
            await self._set_rls_context(None)

        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        referrer_user_id = await self._resolve_referrer_user_id(request.referral_code)

        self.db.add(
            FeedView(
                post_id=post.id,
                user_id=user_id,
                viewed_at=_utcnow(),
                session_id=request.session_id,
                duration_seconds=request.duration_seconds,
                ip_address=ip_address,
                user_agent=user_agent,
                referrer=referrer,
                referral_code=(request.referral_code or "").strip() or None,
                referrer_user_id=referrer_user_id,
            )
        )

        post.view_count = int(post.view_count or 0) + 1
        await self.db.commit()

        return TrackViewResponse(
            success=True,
            view_count=int(post.view_count or 0),
            unique_viewers=0,
        )

    async def subscribe_digest(
        self,
        email: str,
        user_payload: Optional[Dict[str, Any]],
    ) -> "DigestSubscribeResponse":
        from src.modules.feed.schemas import DigestSubscribeResponse
        import re
        import secrets

        clean = email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email address")

        user_id = self.resolve_user_id(user_payload)
        existing = await self.db.scalar(
            select(FeedDigestSubscription).where(FeedDigestSubscription.email == clean)
        )
        if existing:
            existing.is_active = True
            if user_id and not existing.user_id:
                existing.user_id = user_id
            await self.db.commit()
            return DigestSubscribeResponse(success=True, message="You are subscribed to the weekly digest.")

        row = FeedDigestSubscription(
            email=clean,
            user_id=user_id,
            unsubscribe_token=secrets.token_urlsafe(32),
            is_active=True,
        )
        self.db.add(row)
        await self.db.commit()
        return DigestSubscribeResponse(success=True, message="You are subscribed to the weekly digest.")

    async def unsubscribe_digest(self, token: str) -> "DigestSubscribeResponse":
        from src.modules.feed.schemas import DigestSubscribeResponse

        clean = token.strip()
        if not clean:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

        row = await self.db.scalar(
            select(FeedDigestSubscription).where(FeedDigestSubscription.unsubscribe_token == clean)
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")

        row.is_active = False
        await self.db.commit()
        return DigestSubscribeResponse(success=True, message="You have been unsubscribed.")

    async def send_digest_emails(self, *, cron_secret: Optional[str] = None) -> "DigestSendResponse":
        import os

        from src.modules.feed.schemas import DigestSendResponse
        from src.shared.transactional_email import send_transactional_email

        expected = os.getenv("FEED_DIGEST_CRON_SECRET", "").strip()
        if expected and (cron_secret or "").strip() != expected:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid cron secret")

        preview = await self.get_digest_preview(period_days=7, limit=8)
        if not preview.items:
            return DigestSendResponse(success=True, sent_count=0, skipped=True)

        subs = (
            await self.db.scalars(
                select(FeedDigestSubscription).where(FeedDigestSubscription.is_active.is_(True))
            )
        ).all()
        if not subs:
            return DigestSendResponse(success=True, sent_count=0, skipped=True)

        site = os.getenv("AISER_PUBLIC_SITE_URL", "http://localhost:3000").rstrip("/")
        lines = ["Top public insights this week on Aicser Discover:", ""]
        for item in preview.items:
            lines.append(f"• {item.title} — {site}/discover/{item.id}")
        lines.extend(["", f"Browse more: {site}/discover", ""])
        body = "\n".join(lines)
        subject = "Aicser Discover — trending insights this week"

        sent = 0
        now = _utcnow()
        for sub in subs:
            personalized = body + f"\nUnsubscribe: {site}/discover?unsubscribe={sub.unsubscribe_token}"
            ok = await send_transactional_email([sub.email], subject, personalized)
            if ok:
                sub.last_sent_at = now
                sent += 1
        await self.db.commit()
        return DigestSendResponse(success=True, sent_count=sent)

    async def remix_feed_post(
        self,
        item_id: UUID,
        user_payload: Optional[Dict[str, Any]],
        *,
        project_id: Optional[UUID] = None,
        referral_code: Optional[str] = None,
    ) -> "RemixFeedResponse":
        from src.modules.feed.remix_utils import remix_snapshot_to_dashboard
        from src.modules.feed.schemas import RemixFeedResponse

        user_id = self.resolve_user_id(user_payload)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        await self._set_rls_context(user_id)
        await self._ensure_user_row(user_id, user_payload)

        post = await self._get_post_or_404(item_id)
        await self._assert_can_view_post(user_id, post)

        if _enum_value(getattr(post, "render_mode", None)) != "snapshot" or not post.current_snapshot_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only snapshot publications can be remixed",
            )

        snapshot = await self.db.scalar(
            select(FeedSnapshot).where(FeedSnapshot.id == post.current_snapshot_id)
        )
        if not snapshot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")

        dashboard = await remix_snapshot_to_dashboard(
            self.db,
            post=post,
            snapshot=snapshot,
            user_id=user_id,
            project_id=project_id,
            referral_code=referral_code,
        )

        await self._log_event(
            actor_id=user_id,
            event_type="share",
            post=post,
            target_user_id=post.author_id,
            metadata={"action": "remix", "dashboardId": str(dashboard.id)},
        )
        await self.db.commit()

        title = dashboard.name or dashboard.title or "Remix"
        return RemixFeedResponse(
            success=True,
            dashboard_id=str(dashboard.id),
            open_path=f"/dashboards/{dashboard.id}",
            title=title,
        )
