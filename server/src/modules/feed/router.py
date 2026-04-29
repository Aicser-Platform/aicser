"""API routes for social feed."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, current_user_payload
from src.modules.authentication.helpers import extract_user_payload
from src.modules.feed.schemas import (
    AddCommentRequest,
    AddCommentResponse,
    AddCollectionItemRequest,
    ActivityFeedResponse,
    ApprovalDecisionRequest,
    ApprovalDecisionResponse,
    ApprovalQueueResponse,
    AssetType,
    CreateCollectionRequest,
    DeleteItemResponse,
    DeleteCollectionResponse,
    DeleteCommentResponse,
    FeedCollectionDetail,
    FeedCollectionItem,
    FeedCollectionListResponse,
    FeedFilterOptionsResponse,
    FeedItemResponse,
    FeedResponse,
    FeedScope,
    FeedSidebarResponse,
    FeedSort,
    MarkNotificationReadResponse,
    LeaderboardSortBy,
    LeaderboardTimeRange,
    PublishAssetRequest,
    PublishAssetResponse,
    ReactCommentRequest,
    ReactCommentResponse,
    ReactRequest,
    ReactResponse,
    FollowAuthorResponse,
    SaveResponse,
    ShareResponse,
    TrackViewRequest,
    TrackViewResponse,
    UpdateCommentRequest,
    UpdateCommentResponse,
    UpdateCollectionItemRequest,
    UpdateCollectionRequest,
    NotificationResponse,
)
from src.modules.feed.service import FeedService

router = APIRouter()


def _normalize_user_payload(token_or_payload: Any) -> Dict[str, Any]:
    if isinstance(token_or_payload, dict):
        return token_or_payload
    if isinstance(token_or_payload, str):
        return extract_user_payload(token_or_payload)
    return {}


@router.get("", response_model=FeedResponse)
async def get_feed(
    scope: FeedScope = Query(default=FeedScope.organization),
    sort: FeedSort = Query(default=FeedSort.recommended),
    tags: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    author_id: Optional[str] = Query(default=None, alias="authorId"),
    asset_type: Optional[AssetType] = Query(default=None, alias="assetType"),
    time_window_days: Optional[int] = Query(default=None, ge=1, le=365, alias="timeWindowDays"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedResponse:
    service = FeedService(db)
    return await service.get_feed(
        scope=scope,
        sort=sort,
        tags=tags,
        search=search,
        author_id=author_id,
        asset_type=asset_type,
        time_window_days=time_window_days,
        limit=limit,
        offset=offset,
        user_payload=_normalize_user_payload(current_user),
        organization_id=organization_id,
        project_id=project_id,
    )


@router.get("/public", response_model=FeedResponse)
async def get_public_feed(
    sort: FeedSort = Query(default=FeedSort.recommended),
    tags: Optional[List[str]] = Query(default=None),
    search: Optional[str] = Query(default=None),
    author_id: Optional[str] = Query(default=None, alias="authorId"),
    asset_type: Optional[AssetType] = Query(default=None, alias="assetType"),
    time_window_days: Optional[int] = Query(default=None, ge=1, le=365, alias="timeWindowDays"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_async_session),
    ) -> FeedResponse:
    service = FeedService(db)
    return await service.get_feed(
        scope=FeedScope.public,
        sort=sort,
        tags=tags,
        search=search,
        author_id=author_id,
        asset_type=asset_type,
        time_window_days=time_window_days,
        limit=limit,
        offset=offset,
        user_payload=None,
    )


@router.get("/public/trending", response_model=FeedResponse)
async def get_public_trending_feed(
    tags: Optional[List[str]] = Query(default=None),
    author_id: Optional[str] = Query(default=None, alias="authorId"),
    asset_type: Optional[AssetType] = Query(default=None, alias="assetType"),
    time_window_days: Optional[int] = Query(default=None, ge=1, le=365, alias="timeWindowDays"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_async_session),
) -> FeedResponse:
    service = FeedService(db)
    return await service.get_trending_feed(
        scope=FeedScope.public,
        tags=tags,
        author_id=author_id,
        asset_type=asset_type,
        time_window_days=time_window_days,
        limit=limit,
        offset=offset,
        user_payload=None,
    )


@router.get("/trending", response_model=FeedResponse)
async def get_trending_feed(
    scope: FeedScope = Query(default=FeedScope.organization),
    tags: Optional[List[str]] = Query(default=None),
    author_id: Optional[str] = Query(default=None, alias="authorId"),
    asset_type: Optional[AssetType] = Query(default=None, alias="assetType"),
    time_window_days: Optional[int] = Query(default=None, ge=1, le=365, alias="timeWindowDays"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedResponse:
    service = FeedService(db)
    return await service.get_trending_feed(
        scope=scope,
        tags=tags,
        author_id=author_id,
        asset_type=asset_type,
        time_window_days=time_window_days,
        limit=limit,
        offset=offset,
        user_payload=_normalize_user_payload(current_user),
        organization_id=organization_id,
        project_id=project_id,
    )


@router.get("/saved", response_model=FeedResponse)
async def get_saved_feed(
    sort: FeedSort = Query(default=FeedSort.recent),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedResponse:
    service = FeedService(db)
    return await service.get_saved_feed(
        sort=sort,
        limit=limit,
        offset=offset,
        user_payload=_normalize_user_payload(current_user),
    )


@router.get("/commented", response_model=FeedResponse)
async def get_commented_feed(
    sort: FeedSort = Query(default=FeedSort.recent),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedResponse:
    service = FeedService(db)
    return await service.get_commented_feed(
        sort=sort,
        limit=limit,
        offset=offset,
        user_payload=_normalize_user_payload(current_user),
    )


@router.get("/filters", response_model=FeedFilterOptionsResponse)
async def get_feed_filters(
    scope: FeedScope = Query(default=FeedScope.organization),
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedFilterOptionsResponse:
    service = FeedService(db)
    return await service.get_filter_options(
        _normalize_user_payload(current_user),
        scope=scope,
        organization_id=organization_id,
        project_id=project_id,
    )


@router.get("/sidebar", response_model=FeedSidebarResponse)
async def get_feed_sidebar(
    scope: FeedScope = Query(default=FeedScope.organization),
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    time_range: LeaderboardTimeRange = Query(default=LeaderboardTimeRange.week, alias="timeRange"),
    content_type: Optional[AssetType] = Query(default=None, alias="contentType"),
    sort_by: LeaderboardSortBy = Query(default=LeaderboardSortBy.popular, alias="sortBy"),
    leaderboard_limit: int = Query(default=8, ge=3, le=20, alias="leaderboardLimit"),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
    ) -> FeedSidebarResponse:
    service = FeedService(db)
    return await service.get_sidebar_data(
        user_payload=_normalize_user_payload(current_user),
        scope=scope,
        organization_id=organization_id,
        project_id=project_id,
        time_range=time_range,
        content_type=content_type,
        sort_by=sort_by,
        leaderboard_limit=leaderboard_limit,
    )


@router.get("/approvals/queue", response_model=ApprovalQueueResponse)
async def get_approval_queue(
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ApprovalQueueResponse:
    service = FeedService(db)
    return await service.get_approval_queue(
        user_payload=_normalize_user_payload(current_user),
        organization_id=organization_id,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )


@router.post("/approvals/{item_id}/approve", response_model=ApprovalDecisionResponse)
async def approve_feed_item(
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ApprovalDecisionResponse:
    service = FeedService(db)
    return await service.approve_publication(item_id, _normalize_user_payload(current_user))


@router.post("/approvals/{item_id}/reject", response_model=ApprovalDecisionResponse)
async def reject_feed_item(
    item_id: UUID,
    payload: ApprovalDecisionRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ApprovalDecisionResponse:
    service = FeedService(db)
    return await service.reject_publication(item_id, payload, _normalize_user_payload(current_user))


@router.get("/notifications", response_model=NotificationResponse)
async def list_notifications(
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> NotificationResponse:
    service = FeedService(db)
    return await service.get_notifications(
        user_payload=_normalize_user_payload(current_user),
        limit=limit,
        offset=offset,
        unread_only=unread_only,
    )


@router.post("/notifications/{notification_id}/read", response_model=MarkNotificationReadResponse)
async def mark_notification_read(
    notification_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> MarkNotificationReadResponse:
    service = FeedService(db)
    return await service.mark_notification_read(notification_id, _normalize_user_payload(current_user))


@router.get("/activity", response_model=ActivityFeedResponse)
async def get_activity_feed(
    organization_id: Optional[UUID] = Query(default=None, alias="organizationId"),
    project_id: Optional[UUID] = Query(default=None, alias="projectId"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ActivityFeedResponse:
    service = FeedService(db)
    return await service.get_activity_feed(
        user_payload=_normalize_user_payload(current_user),
        organization_id=organization_id,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )

@router.get("/collections", response_model=FeedCollectionListResponse)
async def list_collections(
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionListResponse:
    service = FeedService(db)
    return await service.get_collections(_normalize_user_payload(current_user))


@router.post("/collections", response_model=FeedCollectionDetail, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CreateCollectionRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionDetail:
    service = FeedService(db)
    return await service.create_collection(payload, _normalize_user_payload(current_user))


@router.get("/collections/{collection_id}", response_model=FeedCollectionDetail)
async def get_collection_detail(
    collection_id: UUID,
    current_user: Dict[str, Any] = Depends(current_user_payload),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionDetail:
    service = FeedService(db)
    return await service.get_collection_detail(collection_id, _normalize_user_payload(current_user))


@router.patch("/collections/{collection_id}", response_model=FeedCollectionDetail)
async def update_collection(
    collection_id: UUID,
    payload: UpdateCollectionRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionDetail:
    service = FeedService(db)
    return await service.update_collection(collection_id, payload, _normalize_user_payload(current_user))


@router.delete("/collections/{collection_id}", response_model=DeleteCollectionResponse)
async def delete_collection(
    collection_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> DeleteCollectionResponse:
    service = FeedService(db)
    return await service.delete_collection(collection_id, _normalize_user_payload(current_user))


@router.post("/collections/{collection_id}/items", response_model=FeedCollectionItem)
async def add_collection_item(
    collection_id: UUID,
    payload: AddCollectionItemRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionItem:
    service = FeedService(db)
    return await service.add_collection_item(collection_id, payload, _normalize_user_payload(current_user))


@router.patch("/collections/{collection_id}/items/{item_id}", response_model=FeedCollectionItem)
async def update_collection_item(
    collection_id: UUID,
    item_id: UUID,
    payload: UpdateCollectionItemRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FeedCollectionItem:
    service = FeedService(db)
    return await service.update_collection_item(collection_id, item_id, payload, _normalize_user_payload(current_user))


@router.delete("/collections/{collection_id}/items/{item_id}", response_model=DeleteCollectionResponse)
async def remove_collection_item(
    collection_id: UUID,
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> DeleteCollectionResponse:
    service = FeedService(db)
    return await service.remove_collection_item(collection_id, item_id, _normalize_user_payload(current_user))


@router.post("/publications", response_model=PublishAssetResponse, status_code=status.HTTP_201_CREATED)
async def publish_feed_asset(
    payload: PublishAssetRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> PublishAssetResponse:
    service = FeedService(db)
    return await service.publish_asset(payload, _normalize_user_payload(current_user))


@router.post("/authors/{author_id}/follow", response_model=FollowAuthorResponse)
async def toggle_follow_author(
    author_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> FollowAuthorResponse:
    service = FeedService(db)
    return await service.toggle_follow_author(author_id, _normalize_user_payload(current_user))


@router.delete("/{item_id}", response_model=DeleteItemResponse)
async def delete_feed_item(
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> DeleteItemResponse:
    service = FeedService(db)
    return await service.delete_item(item_id, _normalize_user_payload(current_user))


@router.post("/{item_id}/react", response_model=ReactResponse)
async def react_to_feed_item(
    item_id: UUID,
    payload: ReactRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ReactResponse:
    service = FeedService(db)
    return await service.react_to_item(item_id, payload, _normalize_user_payload(current_user))


@router.post("/{item_id}/save", response_model=SaveResponse)
async def save_feed_item(
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> SaveResponse:
    service = FeedService(db)
    return await service.toggle_save_item(item_id, _normalize_user_payload(current_user))


@router.post("/{item_id}/share", response_model=ShareResponse)
async def share_feed_item(
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ShareResponse:
    service = FeedService(db)
    return await service.share_item(item_id, _normalize_user_payload(current_user))


@router.post("/{item_id}/comments", response_model=AddCommentResponse)
async def add_feed_comment(
    item_id: UUID,
    payload: AddCommentRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> AddCommentResponse:
    service = FeedService(db)
    return await service.add_comment(item_id, payload, _normalize_user_payload(current_user))


@router.patch("/{item_id}/comments/{comment_id}", response_model=UpdateCommentResponse)
async def update_feed_comment(
    item_id: UUID,
    comment_id: UUID,
    payload: UpdateCommentRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> UpdateCommentResponse:
    service = FeedService(db)
    return await service.update_comment(item_id, comment_id, payload, _normalize_user_payload(current_user))


@router.delete("/{item_id}/comments/{comment_id}", response_model=DeleteCommentResponse)
async def delete_feed_comment(
    item_id: UUID,
    comment_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> DeleteCommentResponse:
    service = FeedService(db)
    return await service.delete_comment(item_id, comment_id, _normalize_user_payload(current_user))


@router.post("/{item_id}/comments/{comment_id}/react", response_model=ReactCommentResponse)
async def react_to_feed_comment(
    item_id: UUID,
    comment_id: UUID,
    payload: ReactCommentRequest,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> ReactCommentResponse:
    service = FeedService(db)
    return await service.react_to_comment(item_id, comment_id, payload, _normalize_user_payload(current_user))


@router.post("/{item_id}/views", response_model=TrackViewResponse)
async def track_feed_item_view(
    item_id: UUID,
    payload: TrackViewRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> TrackViewResponse:
    service = FeedService(db)
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    referrer = request.headers.get("referer")
    return await service.track_view(
        item_id,
        payload,
        _normalize_user_payload(current_user),
        ip_address=ip_address,
        user_agent=user_agent,
        referrer=referrer,
    )


@router.get("/{item_id}", response_model=FeedItemResponse)
async def get_feed_item_detail(
    item_id: UUID,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    service = FeedService(db)
    item = await service.get_item_by_id(item_id, _normalize_user_payload(current_user))
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed item not found")
    return item
