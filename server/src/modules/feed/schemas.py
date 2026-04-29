"""Schemas for social feed APIs."""

from enum import Enum
from typing import Any, Dict, List, Optional
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


class PublicationStatus(str, Enum):
    draft = "draft"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


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


class FeedAssetPreview(BaseModel):
    type: str
    data: Optional[List[int]] = None
    label: Optional[str] = None


class FeedAssetPayload(BaseModel):
    summary: str
    previewLabel: str
    previewType: Optional[str] = None
    previewData: Optional[List[int]] = None
    previews: Optional[List[FeedAssetPreview]] = None


class FeedUserInteraction(BaseModel):
    reaction: Optional[ReactionType] = None
    isBookmarked: bool = False
    isFollowingAuthor: bool = False


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


class FeedResponse(BaseModel):
    items: List[FeedItemResponse]
    total: int
    limit: int
    offset: int


class FeedAssetCounts(BaseModel):
    dashboard: int = 0
    chart: int = 0
    insight: int = 0


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


class PublishAssetRequest(BaseModel):
    asset_type: AssetType = Field(..., description="dashboard/chart")
    asset_id: UUID
    organization_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    visibility: FeedVisibility = FeedVisibility.private
    status: PublicationStatus = PublicationStatus.approved
    featured: bool = False
    featured_until: Optional[datetime] = None
    public_access_level: Optional[str] = "results_only"
    requires_login: bool = True
    rejection_reason: Optional[str] = None


class PublishAssetResponse(BaseModel):
    success: bool
    publication_id: str
    status: PublicationStatus


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


class TrackViewResponse(BaseModel):
    success: bool
    view_count: int
    unique_viewers: int


FeedComment.model_rebuild()
