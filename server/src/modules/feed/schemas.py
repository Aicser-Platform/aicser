"""Schemas for social feed APIs."""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from datetime import datetime


class FeedVisibility(str, Enum):
    private = "private"
    project = "project"
    organization = "organization"
    public = "public"


class FeedScope(str, Enum):
    private = "private"
    organization = "organization"
    project = "project"
    public = "public"
    following = "following"


class FeedSort(str, Enum):
    recommended = "recommended"
    trending = "trending"
    recent = "recent"


class LeaderboardTimeRange(str, Enum):
    today = "today"
    week = "week"
    month = "month"
    all = "all"


class LeaderboardSortBy(str, Enum):
    popular = "popular"
    voted = "voted"
    viewed = "viewed"
    discussed = "discussed"


class AssetType(str, Enum):
    dashboard = "dashboard"
    chart = "chart"
    insight = "insight"
    query = "query"
    # Pure-text discussion post - no backing dashboard/chart/insight/query row.
    post = "post"


class PublicationStatus(str, Enum):
    draft = "draft"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class FeedRenderMode(str, Enum):
    snapshot = "snapshot"
    live = "live"


class ReactionType(str, Enum):
    like = "like"
    love = "love"
    insightful = "insightful"
    applause = "applause"
    funny = "funny"
    celebrate = "celebrate"



class FeedAuthor(BaseModel):
    id: str
    name: str
    username: str
    avatarUrl: Optional[str] = None
    title: Optional[str] = None
    # Only ever populated on the /discover/author profile response - every
    # comment/post author in the main feed also serializes through this same
    # schema, and a bio (up to 500 chars, Settings -> Profile) repeated on
    # every single interaction's author would be pure bloat for data nobody
    # reads there. None everywhere else is one harmless extra null field.
    bio: Optional[str] = None


class FeedComment(BaseModel):
    id: str
    author: FeedAuthor
    content: str
    createdAt: str
    parentCommentId: Optional[str] = None
    editedAt: Optional[str] = None
    isEdited: bool = False
    isPostAuthor: bool = False
    canEdit: bool = False
    replyCount: int = 0
    reactions: Dict[ReactionType, int] = Field(default_factory=dict)
    reactionCount: int = 0
    userReaction: Optional[ReactionType] = None
    replies: List["FeedComment"] = Field(default_factory=list)


class FeedMetrics(BaseModel):
    views: int
    comments: int
    reactions: int
    bookmarks: int
    shares: int
    # Per-type breakdown (e.g. {"like": 3, "love": 1}) - mirrors FeedComment's
    # own `reactions` field, which comments already had; posts only exposed
    # the flat total above until now.
    reactionBreakdown: Dict[ReactionType, int] = Field(default_factory=dict)


class FeedAssetPreview(BaseModel):
    type: str
    data: Optional[List[float]] = None
    label: Optional[str] = None


class FeedAssetPayload(BaseModel):
    summary: str
    previewLabel: str
    previewType: Optional[str] = None
    previewData: Optional[List[float]] = None
    previews: Optional[List[FeedAssetPreview]] = None
    chartWidget: Optional[Dict[str, Any]] = None
    dashboardId: Optional[str] = None
    sourceQueryId: Optional[str] = None
    excerpt: Optional[str] = None
    questionTitle: Optional[str] = None
    conversationId: Optional[str] = None
    messageId: Optional[str] = None
    snapshotPayload: Optional[Dict[str, Any]] = None
    widgetCount: Optional[int] = None
    thumbnailUrl: Optional[str] = None


class FeedSnapshotInfo(BaseModel):
    version: int = 0
    capturedAt: Optional[str] = None
    renderMode: FeedRenderMode = FeedRenderMode.live


class FeedUserInteraction(BaseModel):
    reaction: Optional[ReactionType] = None
    isBookmarked: bool = False
    isFollowingAuthor: bool = False


class FeedAttachmentPayload(BaseModel):
    """One existing dashboard/chart referenced by a post. Backed by a real feed
    publication (`referencedPostId`) - auto-published the first time it's
    attached anywhere, same pipeline as "Publish to Feed" - so the deep link
    is just /feed/{referencedPostId} (always correct) and the preview fields
    are the same ones a normal feed post already renders with
    (FeedPreviewVisual), not a bespoke bare-button rendering.
    `restricted=True` means the CURRENT VIEWER can't see that publication -
    no title/preview is included in that case (per-viewer check against the
    referenced post's own visibility, in service_serialization.py), the UI
    renders a placeholder instead. `referencedPostId` is unset only if the
    publication was later deleted - the UI renders "no longer available"."""
    asset_type: Literal["dashboard", "chart"]
    asset_id: str
    restricted: bool = False
    title: Optional[str] = None
    # The referenced publication's own description - carried through so an
    # attached chart/dashboard's tile can show the same title+description
    # pairing a normal "Publish to Feed" post renders with, instead of a
    # bare title with no insight/summary text at all.
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    referencedPostId: Optional[str] = None
    # The referenced publication's own render mode - "snapshot" means the
    # preview* fields below are the complete, correct picture (render as-is,
    # like a normal snapshot post); "live" (the common case for an
    # auto-published attachment, which carries no captured snapshot) means
    # the frontend must fetch live data using asset_id (+ dashboardId for a
    # chart) instead, the same path a normal live dashboard/chart post uses.
    renderMode: str = "live"
    # Chart attachments only: the parent dashboard's id, needed for the live
    # chart-fetch path (chartService.getChart(dashboardId, chartId)) - unset
    # for dashboard-type attachments, where asset_id already IS the dashboard.
    dashboardId: Optional[str] = None
    previewType: Optional[str] = None
    previewData: Optional[List[float]] = None
    previews: Optional[List[FeedAssetPreview]] = None
    chartWidget: Optional[Dict[str, Any]] = None
    # Only set when renderMode is "snapshot" - the full captured payload
    # (widgets + data + layout), read directly with NO live fetch at all by
    # FeedPostViewer/FeedSnapshotViewer. This is the actual performance fix:
    # previewType/previews above are just the lightweight grid-tile summary.
    snapshotPayload: Optional[Dict[str, Any]] = None


class FeedItemResponse(BaseModel):
    id: str
    assetType: AssetType
    assetId: str
    title: str
    description: str
    tags: List[str]
    visibility: FeedVisibility
    approvalStatus: PublicationStatus
    publishedAt: str
    lastActivityAt: str
    author: FeedAuthor
    metrics: FeedMetrics
    userInteraction: FeedUserInteraction
    recentComments: List[FeedComment]
    asset: FeedAssetPayload
    renderMode: FeedRenderMode = FeedRenderMode.live
    snapshot: Optional[FeedSnapshotInfo] = None
    isOwner: bool = False
    attachments: List[FeedAttachmentPayload] = Field(default_factory=list)
    mentions: List[str] = Field(default_factory=list)
    editedAt: Optional[str] = None
    isEdited: bool = False
    canEdit: bool = False


class FeedResponse(BaseModel):
    items: List[FeedItemResponse]
    total: int
    limit: int
    offset: int


class FeedAssetCounts(BaseModel):
    dashboard: int = 0
    chart: int = 0
    insight: int = 0
    query: int = 0
    post: int = 0


class FeedFilterOptionsResponse(BaseModel):
    tags: List[str]
    authors: List[FeedAuthor]
    assetCounts: FeedAssetCounts


class FeedSidebarTag(BaseModel):
    tag: str
    count: int


class FeedSidebarCollection(BaseModel):
    id: str
    name: str
    count: int
    color: Optional[str] = None


class FeedSidebarActivity(BaseModel):
    id: str
    postId: Optional[str] = None
    actor: FeedAuthor
    action: str
    assetType: AssetType
    title: str
    time: str


class FeedLeaderboardTrend(str, Enum):
    up = "up"
    down = "down"
    new = "new"
    stable = "stable"


class FeedLeaderboardItem(BaseModel):
    id: str
    rank: int
    postId: str
    assetType: AssetType
    title: str
    creator: FeedAuthor
    thumbnailType: Optional[str] = None
    categoryTag: Optional[str] = None
    popularityCount: int = 0
    voteCount: int = 0
    viewCount: int = 0
    commentCount: int = 0
    saveCount: int = 0
    shareCount: int = 0
    engagementScore: int = 0
    trend: FeedLeaderboardTrend = FeedLeaderboardTrend.stable
    trendDelta: int = 0
    userInteraction: FeedUserInteraction = Field(default_factory=FeedUserInteraction)


class FeedTopContributor(BaseModel):
    id: str
    author: FeedAuthor
    contributionCount: int
    engagementScore: int


class FeedRecommendedItem(BaseModel):
    id: str
    postId: str
    assetType: AssetType
    title: str
    creator: FeedAuthor
    reason: str
    score: int


class FeedSidebarResponse(BaseModel):
    leaderboard: List[FeedLeaderboardItem] = Field(default_factory=list)
    topContributors: List[FeedTopContributor] = Field(default_factory=list)
    recommended: List[FeedRecommendedItem] = Field(default_factory=list)
    trendingTags: List[FeedSidebarTag]
    collections: List[FeedSidebarCollection]
    activity: List[FeedSidebarActivity]


class ActivityFeedItem(BaseModel):
    id: str
    actor: FeedAuthor
    action: str
    assetType: AssetType
    title: str
    time: str
    postId: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ActivityFeedResponse(BaseModel):
    items: List[ActivityFeedItem]
    total: int
    limit: int
    offset: int


class ApprovalQueueItem(BaseModel):
    id: str
    item: FeedItemResponse
    submittedAt: str
    visibility: FeedVisibility
    status: PublicationStatus
    organizationId: Optional[str] = None
    projectId: Optional[str] = None
    rejectionReason: Optional[str] = None


class ApprovalQueueResponse(BaseModel):
    items: List[ApprovalQueueItem]
    total: int
    limit: int
    offset: int


class ApprovalDecisionRequest(BaseModel):
    reason: Optional[str] = None


class ApprovalDecisionResponse(BaseModel):
    success: bool
    status: PublicationStatus
    approvedAt: Optional[str] = None
    rejectedAt: Optional[str] = None


class NotificationItem(BaseModel):
    id: str
    type: str
    actor: Optional[FeedAuthor] = None
    postId: Optional[str] = None
    commentId: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    isRead: bool = False
    createdAt: str


class NotificationResponse(BaseModel):
    items: List[NotificationItem]
    total: int
    limit: int
    offset: int


class MarkNotificationReadResponse(BaseModel):
    success: bool


class FeedCollectionSummary(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    isPublic: bool = False
    itemCount: int = 0
    organizationId: Optional[str] = None
    projectId: Optional[str] = None
    createdAt: str
    updatedAt: str


class FeedCollectionItem(BaseModel):
    id: str
    postId: str
    note: Optional[str] = None
    createdAt: str
    post: Optional[FeedItemResponse] = None


class FeedCollectionDetail(FeedCollectionSummary):
    items: List[FeedCollectionItem] = Field(default_factory=list)


class FeedCollectionListResponse(BaseModel):
    collections: List[FeedCollectionSummary]


class CreateCollectionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    organization_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    is_public: bool = False


class UpdateCollectionRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_public: Optional[bool] = None


class AddCollectionItemRequest(BaseModel):
    post_id: UUID
    note: Optional[str] = None


class UpdateCollectionItemRequest(BaseModel):
    note: Optional[str] = None


class DeleteCollectionResponse(BaseModel):
    success: bool


class PublicationMode(str, Enum):
    update = "update"
    create_new = "create_new"


class AttachmentRef(BaseModel):
    """One existing dashboard/chart a NEW post wants to reference. Validated
    against the AUTHOR's own access at publish time (publish_asset), then
    re-checked per-VIEWER at read time (service_serialization.py)."""
    asset_type: Literal["dashboard", "chart"]
    asset_id: UUID
    # Captured client-side at pick time (AttachmentPicker, reusing the same
    # snapshot-build logic "Publish to Feed" already uses) so the auto-
    # published attachment publication renders from a stored snapshot
    # instead of a live per-viewer query - see _get_or_create_attachment_
    # publication. None falls back to a live render, same as before.
    snapshot_payload: Optional[Dict[str, Any]] = None


MAX_POST_ATTACHMENTS = 5


class PublishAssetRequest(BaseModel):
    asset_type: AssetType = Field(..., description="dashboard/chart/insight/query/post")
    asset_id: Optional[UUID] = None
    source_query_id: Optional[str] = Field(None, description="Saved query id; resolves asset_id for query posts")
    organization_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    # Required for dashboard/chart/insight/query (enforced in publish_asset,
    # not here, since a "post" uses `description` as its body text instead and
    # doesn't need a separate headline - see publish_asset's own validation).
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    visibility: FeedVisibility = FeedVisibility.private
    status: PublicationStatus = PublicationStatus.approved
    featured: bool = False
    featured_until: Optional[datetime] = None
    public_access_level: Optional[str] = "results_only"
    requires_login: bool = False
    publication_mode: PublicationMode = PublicationMode.update
    publication_id: Optional[UUID] = Field(
        None,
        description="Explicit post to update when publication_mode=update",
    )
    rejection_reason: Optional[str] = None
    preview_metadata: Optional[Dict[str, Any]] = None
    render_mode: FeedRenderMode = FeedRenderMode.snapshot
    snapshot_payload: Optional[Dict[str, Any]] = None
    thumbnail_url: Optional[str] = None
    # Text-post-only fields (both no-op for dashboard/chart/insight/query).
    attachments: Optional[List[AttachmentRef]] = Field(None, max_length=MAX_POST_ATTACHMENTS)
    mentioned_users: Optional[List[UUID]] = None


class PublicationLookupResponse(BaseModel):
    exists: bool
    publication_id: Optional[str] = None
    title: Optional[str] = None
    published_at: Optional[datetime] = None
    snapshot_version: int = 0
    visibility: Optional[FeedVisibility] = None
    # The asset's REAL project (dashboard/chart owning project, authoritative -
    # see publish_asset's own "use the asset's own project_id, not the
    # client-supplied one" security note). The composer's active/header
    # project can silently differ from this, and publish_asset always wins
    # with this one - surfacing it here BEFORE the user picks a visibility
    # lets the UI show the true destination up front instead of only after
    # publishing, when a mismatch used to be a surprise on the success screen.
    asset_project_id: Optional[str] = None
    asset_project_name: Optional[str] = None


class PublicAuthorStats(BaseModel):
    post_count: int = 0
    total_views: int = 0
    follower_count: int = 0


class PublicAuthorProfileResponse(BaseModel):
    author: FeedAuthor
    stats: PublicAuthorStats
    items: List[FeedItemResponse]
    total: int
    limit: int
    offset: int
    isFollowing: bool = False


class DigestSubscribeRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


class DigestSubscribeResponse(BaseModel):
    success: bool
    message: str


class DigestPreviewItem(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    view_count: int = 0
    reaction_count: int = 0
    published_at: Optional[datetime] = None


class DigestPreviewResponse(BaseModel):
    items: List[DigestPreviewItem]
    period_days: int = 7


class DigestSendResponse(BaseModel):
    success: bool
    sent_count: int = 0
    skipped: bool = False


class UpdateSnapshotRequest(BaseModel):
    snapshot_payload: Dict[str, Any] = Field(..., description="Full immutable snapshot payload")
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    preview_metadata: Optional[Dict[str, Any]] = None
    thumbnail_url: Optional[str] = None


class PublishAssetResponse(BaseModel):
    success: bool
    publication_id: str
    status: PublicationStatus
    snapshot_version: int = 0
    render_mode: FeedRenderMode = FeedRenderMode.snapshot
    # The project this post actually landed under - resolved server-side
    # from the asset's own project_id (dashboards/charts are project-scoped
    # resources; see service_actions.py's _validate_publish_asset), which
    # deliberately overrides whatever project happens to be active in the
    # composer's header at publish time. Echoing it back lets the frontend
    # confirm the real destination instead of silently assuming it matches
    # the active project - the two can legitimately differ (viewing/
    # publishing an asset that lives in a different project than the one
    # currently selected).
    project_id: Optional[str] = None


class PublishFromChatRequest(BaseModel):
    conversation_id: str
    message_id: str
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    visibility: FeedVisibility = FeedVisibility.private
    organization_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    preview_metadata: Optional[Dict[str, Any]] = None
    render_mode: FeedRenderMode = FeedRenderMode.snapshot
    snapshot_payload: Optional[Dict[str, Any]] = None
    thumbnail_url: Optional[str] = None
    requires_login: bool = False
    publication_mode: PublicationMode = PublicationMode.update


class ChatFeedDraftRequest(BaseModel):
    conversation_id: str
    message_id: str
    draft: Dict[str, Any] = Field(default_factory=dict)


class ChatFeedDraftResponse(BaseModel):
    success: bool
    conversation_id: str
    message_id: str
    draft: Dict[str, Any]


class ReactRequest(BaseModel):
    reaction: ReactionType


class ReactResponse(BaseModel):
    success: bool
    reaction: Optional[ReactionType]
    reaction_count: int


class SaveResponse(BaseModel):
    success: bool
    isBookmarked: bool
    bookmark_count: int


class FollowAuthorResponse(BaseModel):
    success: bool
    author_id: str
    isFollowing: bool


class ShareResponse(BaseModel):
    success: bool
    share_count: int
    share_link: str


class DeleteItemResponse(BaseModel):
    success: bool


class UpdatePostRequest(BaseModel):
    """Edit a pure-text post's own content - mirrors UpdateCommentRequest.
    Scoped to asset_type == "post": a dashboard/chart/insight/query post's
    "content" is the underlying asset itself, re-published via publish_asset,
    not editable through this endpoint."""
    description: str = Field(..., min_length=1)
    mentioned_users: Optional[List[UUID]] = None


class UpdatePostResponse(BaseModel):
    success: bool
    item: FeedItemResponse


class AddCommentRequest(BaseModel):
    content: str = Field(..., min_length=1)
    parent_comment_id: Optional[UUID] = None
    mentioned_users: Optional[List[UUID]] = None


class AddCommentResponse(BaseModel):
    success: bool
    comment: FeedComment
    comment_count: int


class UpdateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1)
    mentioned_users: Optional[List[UUID]] = None


class UpdateCommentResponse(BaseModel):
    success: bool
    comment: FeedComment


class DeleteCommentResponse(BaseModel):
    success: bool
    comment_count: int


class ReactCommentRequest(BaseModel):
    reaction: ReactionType


class ReactCommentResponse(BaseModel):
    success: bool
    reaction: Optional[ReactionType]
    reaction_count: int


class TrackViewRequest(BaseModel):
    session_id: Optional[str] = None
    duration_seconds: Optional[int] = None
    referral_code: Optional[str] = Field(None, max_length=100, description="?ref= attribution handle")


class RemixFeedResponse(BaseModel):
    success: bool
    dashboard_id: str
    open_path: str
    title: str


class RemixFeedRequest(BaseModel):
    project_id: Optional[UUID] = None
    referral_code: Optional[str] = Field(None, max_length=100)


class PublicLeaderboardResponse(BaseModel):
    items: List[FeedLeaderboardItem]
    timeRange: LeaderboardTimeRange = LeaderboardTimeRange.week


class TrackViewResponse(BaseModel):
    success: bool
    view_count: int
    unique_viewers: int


FeedComment.model_rebuild()
