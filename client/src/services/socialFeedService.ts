'use client';

import { fetchApi } from '@/utils/api';

export type FeedVisibility = 'private' | 'project' | 'organization' | 'public' | 'following';
export type FeedScope = 'private' | 'organization' | 'project' | 'public' | 'following';
export type FeedSort = 'recommended' | 'trending' | 'recent';
export type AssetType = 'dashboard' | 'chart' | 'insight' | 'query' | 'post';

/** An existing dashboard/chart a NEW text post wants to reference - access-
 * checked against the author at publish time, then re-checked per-VIEWER at
 * read time (see FeedAttachmentPayload's `restricted` flag). */
export interface AttachmentRef {
  asset_type: 'dashboard' | 'chart' | 'insight';
  asset_id: string;
  /** Pre-captured at pick time (AttachmentPicker) so the resulting
   * publication renders from a stored snapshot instead of a live query on
   * every future view - see buildAttachmentSnapshot.ts for why. */
  snapshot_payload?: Record<string, unknown> | null;
  /** Reuse an already-published feed post instead of auto-publishing a copy. */
  publication_id?: string | null;
}

export interface FeedAttachmentPayload {
  asset_type: 'dashboard' | 'chart' | 'insight';
  asset_id: string;
  restricted: boolean;
  title?: string | null;
  /** The referenced publication's own description - same title+description
   * pairing a normal "Publish to Feed" post renders with. */
  description?: string | null;
  thumbnail_url?: string | null;
  /** The real feed publication behind this attachment - auto-published (same
   * pipeline as "Publish to Feed") the first time it's attached anywhere, so
   * this always deep-links correctly to /feed/{referencedPostId} and has a
   * real preview. Unset only if that publication was later deleted. */
  referencedPostId?: string | null;
  /** "snapshot" = the preview* fields below are complete, render as-is.
   * "live" (the common case - an auto-published attachment carries no
   * captured snapshot) = fetch live data using asset_id (+ dashboardId for
   * a chart), the same path a normal live dashboard/chart post uses. */
  renderMode?: 'live' | 'snapshot';
  /** Chart attachments only: the parent dashboard's id, needed for the live
   * chart-fetch path. Unset for dashboard-type attachments (asset_id IS the
   * dashboard already). */
  dashboardId?: string | null;
  previewType?: FeedPreviewType;
  previewData?: number[];
  previews?: FeedAssetPreview[];
  chartWidget?: {
    chartType: string;
    chartData?: Record<string, unknown>;
    chartOptions?: Record<string, unknown>;
    chartQuery?: Record<string, unknown>;
  } | null;
  /** Only set when renderMode is "snapshot" - the full captured payload,
   * read directly with no live fetch at all (see FeedPostViewer). */
  snapshotPayload?: Record<string, unknown> | null;
}
export type ReactionType = 'like' | 'insightful' | 'love' | 'applause' | 'funny' | 'celebrate';
export type FeedPreviewType = 'bar' | 'pie' | 'line' | 'dashboard';
export type LeaderboardTimeRange = 'today' | 'week' | 'month' | 'all';
export type LeaderboardSortBy = 'popular' | 'voted' | 'viewed' | 'discussed';

export interface FeedAuthor {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  title?: string;
  /** Only ever populated on the /discover/author profile response - see FeedAuthor (schemas.py). */
  bio?: string | null;
}

export interface FeedComment {
  id: string;
  author: FeedAuthor;
  content: string;
  createdAt: string;
  parentCommentId?: string;
  editedAt?: string;
  isEdited?: boolean;
  isPostAuthor?: boolean;
  canEdit?: boolean;
  replyCount?: number;
  reactions?: Partial<Record<ReactionType, number>>;
  reactionCount?: number;
  userReaction?: ReactionType;
  replies?: FeedComment[];
}

export interface FeedMetrics {
  views: number;
  comments: number;
  reactions: number;
  bookmarks: number;
  shares: number;
  /** Per-type breakdown (e.g. {like: 3, love: 1}) - mirrors FeedComment's own `reactions` field. */
  reactionBreakdown?: Partial<Record<ReactionType, number>>;
}

export interface FeedAssetPreview {
  type: FeedPreviewType;
  data?: number[];
  label?: string;
}

export type FeedRenderMode = 'snapshot' | 'live';

export interface FeedSnapshotInfo {
  version: number;
  capturedAt?: string;
  renderMode: FeedRenderMode;
}

export interface FeedItem {
  id: string;
  assetType: AssetType;
  assetId: string;
  title: string;
  description: string;
  tags: string[];
  visibility: FeedVisibility;
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  publishedAt: string;
  lastActivityAt: string;
  author: FeedAuthor;
  metrics: FeedMetrics;
  userInteraction: {
    reaction?: ReactionType;
    isBookmarked: boolean;
    isFollowingAuthor?: boolean;
  };
  recentComments: FeedComment[];
  renderMode?: FeedRenderMode;
  snapshot?: FeedSnapshotInfo;
  isOwner?: boolean;
  asset: {
    summary: string;
    previewLabel: string;
    previewType?: FeedPreviewType;
    previewData?: number[];
    previews?: FeedAssetPreview[];
    dashboardId?: string;
    sourceQueryId?: string;
    snapshotPayload?: Record<string, unknown>;
    snapshotCapturedAt?: string;
    thumbnailUrl?: string;
    widgetCount?: number;
    chartWidget?: {
      chartType: string;
      chartData?: Record<string, unknown>;
      chartOptions?: Record<string, unknown>;
      chartQuery?: Record<string, unknown>;
    };
    excerpt?: string;
    questionTitle?: string;
    conversationId?: string;
    messageId?: string;
  };
  /** Existing dashboards/charts this post references - each already access-
   * checked for the CURRENT viewer server-side (service_serialization.py);
   * `restricted: true` entries have no title/thumbnail and should render a
   * placeholder rather than the real card. */
  attachments?: FeedAttachmentPayload[];
  /** User ids @mentioned in the post body. */
  mentions?: string[];
  editedAt?: string;
  isEdited?: boolean;
  /** True only for the author's own pure-text posts - dashboard/chart/
   * insight/query posts are edited by re-publishing, not through this flag. */
  canEdit?: boolean;
}

export interface FeedQuery {
  scope: FeedScope;
  assetType?: AssetType;
  sort?: FeedSort;
  tags?: string[];
  search?: string;
  authorId?: string;
  limit?: number;
  offset?: number;
  /** Scopes 'organization'/'project' to a SPECIFIC org/project — omitting
   * these doesn't mean "no scope", it falls back (server-side) to every
   * org/project the viewer belongs to. Without them, switching the active
   * project in the header does nothing to the "My Project" feed filter. */
  organizationId?: string;
  projectId?: string;
  /** Narrows 'private' scope ("Only Me") to just the active project — every
   * other scope already follows the active project, but private defaults to
   * cross-project (a personal scratch space) so this is opt-in. Ignored
   * server-side for every other scope. */
  privateProjectOnly?: boolean;
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FeedAssetCounts {
  dashboard: number;
  chart: number;
  insight: number;
  query?: number;
  post?: number;
}

export interface FeedFilterOptions {
  tags: string[];
  authors: FeedAuthor[];
  assetCounts: FeedAssetCounts;
}

export interface FeedSidebarData {
  leaderboard: {
    id: string;
    rank: number;
    postId: string;
    assetType: AssetType;
    title: string;
    creator: FeedAuthor;
    thumbnailType?: string;
    categoryTag?: string;
    popularityCount: number;
    voteCount: number;
    viewCount: number;
    commentCount: number;
    saveCount: number;
    shareCount: number;
    engagementScore: number;
    trend: 'up' | 'down' | 'new' | 'stable';
    trendDelta: number;
    userInteraction: {
      reaction?: ReactionType;
      isBookmarked: boolean;
      isFollowingAuthor?: boolean;
    };
  }[];
  topContributors: {
    id: string;
    author: FeedAuthor;
    contributionCount: number;
    engagementScore: number;
  }[];
  recommended: {
    id: string;
    postId: string;
    assetType: AssetType;
    title: string;
    creator: FeedAuthor;
    reason: string;
    score: number;
  }[];
  trendingTags: { tag: string; count: number }[];
  collections: { id: string; name: string; count: number; color: string }[];
  activity: { id: string; postId?: string; actor: FeedAuthor; action: string; assetType: AssetType; title: string; time: string }[];
}

export interface FeedSidebarQuery {
  timeRange?: LeaderboardTimeRange;
  contentType?: AssetType | 'all';
  sortBy?: LeaderboardSortBy;
  leaderboardLimit?: number;
  organizationId?: string;
  projectId?: string;
  privateProjectOnly?: boolean;
}

export interface FeedReactResult {
  success: boolean;
  reaction?: ReactionType;
  reaction_count: number;
}

export interface FeedSaveResult {
  success: boolean;
  isBookmarked: boolean;
  bookmark_count: number;
}

export interface FeedFollowAuthorResult {
  success: boolean;
  author_id: string;
  isFollowing: boolean;
}

export interface FeedAddCommentResult {
  success: boolean;
  comment: FeedComment;
  comment_count: number;
}

export interface FeedUpdateCommentResult {
  success: boolean;
  comment: FeedComment;
}

export interface FeedDeleteCommentResult {
  success: boolean;
  comment_count: number;
}

export interface FeedCommentReactResult {
  success: boolean;
  reaction?: ReactionType;
  reaction_count: number;
}

export interface FeedShareResult {
  success: boolean;
  share_count: number;
  share_link: string;
}

export interface FeedTrackViewResult {
  success: boolean;
  view_count: number;
  unique_viewers: number;
}

export interface FeedDeleteItemResult {
  success: boolean;
}

export interface FeedUpdatePostResult {
  success: boolean;
  item: FeedItem;
}

export interface PublishAssetRequest {
  asset_type: AssetType;
  asset_id?: string;
  source_query_id?: string;
  organization_id?: string;
  project_id?: string;
  // Required for dashboard/chart/insight/query; a "post"'s body is
  // `description` instead (enforced server-side, not by this type).
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: FeedVisibility;
  status?: 'draft' | 'pending' | 'approved' | 'rejected';
  requires_login?: boolean;
  publication_mode?: 'update' | 'create_new';
  publication_id?: string;
  public_access_level?: 'results_only' | 'full_access';
  featured?: boolean;
  featured_until?: string;
  preview_metadata?: Record<string, unknown>;
  render_mode?: FeedRenderMode;
  snapshot_payload?: Record<string, unknown>;
  thumbnail_url?: string;
  /** Text-post-only fields (both no-op for dashboard/chart/insight/query). */
  attachments?: AttachmentRef[];
  mentioned_users?: string[];
}

export interface PublishFromChatRequest {
  conversation_id: string;
  message_id: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: FeedVisibility;
  organization_id?: string;
  project_id?: string;
  preview_metadata?: Record<string, unknown>;
  render_mode?: FeedRenderMode;
  snapshot_payload?: Record<string, unknown>;
  thumbnail_url?: string;
  requires_login?: boolean;
  publication_mode?: 'update' | 'create_new';
}

export interface PublicationLookupResult {
  exists: boolean;
  publication_id?: string;
  title?: string;
  published_at?: string;
  snapshot_version?: number;
  visibility?: FeedVisibility;
  /** The asset's real project (dashboard/chart owning project) - always wins
   * over whatever project is active in the header at publish time. See
   * FeedPublishComposer's use of this: shown before publish so "Project"
   * visibility never surprises the user with a different destination. */
  asset_project_id?: string | null;
  asset_project_name?: string | null;
}

export interface PublicAuthorStats {
  post_count: number;
  total_views: number;
  follower_count: number;
}

export interface PublicAuthorProfile {
  author: FeedAuthor;
  stats: PublicAuthorStats;
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
  isFollowing?: boolean;
}

export interface DigestPreviewItem {
  id: string;
  title: string;
  description?: string;
  view_count: number;
  reaction_count: number;
  published_at?: string;
}

export interface DigestPreviewResult {
  items: DigestPreviewItem[];
  period_days: number;
}

export interface FeedNotificationItem {
  id: string;
  type: string;
  actor?: FeedAuthor;
  postId?: string;
  commentId?: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface FeedNotificationsResult {
  items: FeedNotificationItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RemixFeedResult {
  success: boolean;
  dashboard_id: string;
  open_path: string;
  title: string;
}

export interface PublicLeaderboardResult {
  items: FeedLeaderboardItem[];
  timeRange: string;
}

export interface FeedLeaderboardItem {
  id: string;
  rank: number;
  postId: string;
  assetType: AssetType;
  title: string;
  creator: FeedAuthor;
  viewCount: number;
  voteCount: number;
  commentCount: number;
  engagementScore: number;
}

export interface UpdateSnapshotRequest {
  snapshot_payload: Record<string, unknown>;
  title?: string;
  description?: string;
  preview_metadata?: Record<string, unknown>;
  thumbnail_url?: string;
}

export interface PublishAssetResponse {
  success: boolean;
  publication_id: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  snapshot_version?: number;
  render_mode?: FeedRenderMode;
  /** The project this post actually landed under, resolved server-side from
   * the asset's own project (not necessarily the composer's active project —
   * see FeedPublishComposer's use of this field). */
  project_id?: string | null;
}

export interface ApprovalQueueItem {
  id: string;
  item: FeedItem;
  submittedAt: string;
  visibility: FeedVisibility;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  organizationId?: string;
  projectId?: string;
  rejectionReason?: string;
}

export interface ApprovalQueueResponse {
  items: ApprovalQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalDecisionResponse {
  success: boolean;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  approvedAt?: string;
  rejectedAt?: string;
}

export const formatTimeAgo = (iso: string) => {
  const date = new Date(iso);
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
};

/**
 * Uploads a captured feed card thumbnail. Best-effort: any failure (network,
 * validation, auth) resolves to `null` so publishing can proceed without one.
 */
export async function uploadFeedThumbnail(blob: Blob): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', blob, 'thumbnail.webp');
    const result = await fetchApi('media/feed-thumbnails', {
      method: 'POST',
      body: formData,
    });
    return typeof result?.url === 'string' ? result.url : null;
  } catch (error) {
    console.warn('[uploadFeedThumbnail] upload failed', error);
    return null;
  }
}

class SocialFeedService {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return fetchApi(endpoint, options) as Promise<T>;
  }

  private buildQuery(params: FeedQuery): string {
    const query = new URLSearchParams();

    query.set('scope', params.scope);
    query.set('sort', params.sort || 'recommended');
    query.set('limit', String(params.limit ?? 20));
    query.set('offset', String(params.offset ?? 0));

    if (params.assetType) query.set('assetType', params.assetType);
    if (params.authorId) query.set('authorId', params.authorId);
    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.organizationId) query.set('organizationId', params.organizationId);
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.privateProjectOnly) query.set('privateProjectOnly', 'true');
    if (params.tags?.length) {
      params.tags.forEach((tag) => {
        if (tag.trim()) query.append('tags', tag.trim());
      });
    }

    return query.toString();
  }

  async getFeed(query: FeedQuery): Promise<FeedResponse> {
    const queryString = this.buildQuery(query);
    return this.request<FeedResponse>(`feed?${queryString}`);
  }

  /** Anonymous public gallery — no auth required. */
  async getPublicFeed(
    query: Pick<FeedQuery, 'sort' | 'tags' | 'search' | 'authorId' | 'assetType' | 'limit' | 'offset'> = {},
  ): Promise<FeedResponse> {
    const params = new URLSearchParams();
    params.set('sort', query.sort || 'recommended');
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.search) params.set('search', query.search);
    if (query.authorId) params.set('authorId', query.authorId);
    if (query.assetType) params.set('assetType', query.assetType);
    if (query.tags?.length) query.tags.forEach((tag) => params.append('tags', tag));
    return this.request<FeedResponse>(`feed/public?${params.toString()}`);
  }

  async getPublicTrendingFeed(
    query: Pick<FeedQuery, 'tags' | 'authorId' | 'assetType' | 'limit' | 'offset'> & {
      timeWindowDays?: number;
    } = {},
  ): Promise<FeedResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 8));
    params.set('offset', String(query.offset ?? 0));
    if (query.authorId) params.set('authorId', query.authorId);
    if (query.assetType) params.set('assetType', query.assetType);
    if (query.timeWindowDays) params.set('timeWindowDays', String(query.timeWindowDays));
    if (query.tags?.length) query.tags.forEach((tag) => params.append('tags', tag));
    return this.request<FeedResponse>(`feed/public/trending?${params.toString()}`);
  }

  async getPublicLeaderboard(limit = 8): Promise<PublicLeaderboardResult> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('timeRange', 'week');
    params.set('sortBy', 'popular');
    return this.request<PublicLeaderboardResult>(`feed/public/leaderboard?${params.toString()}`);
  }

  async remixFeedPost(
    itemId: string,
    body: { project_id?: string; referral_code?: string } = {},
  ): Promise<RemixFeedResult> {
    return this.request<RemixFeedResult>(`feed/public/${itemId}/remix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async getFeedNotifications(
    query: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
  ): Promise<FeedNotificationsResult> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.unreadOnly) params.set('unreadOnly', 'true');
    return this.request<FeedNotificationsResult>(`feed/notifications?${params.toString()}`);
  }

  async markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
    return this.request(`feed/notifications/${notificationId}/read`, { method: 'POST' });
  }

  async getPublicAuthorProfile(
    username: string,
    query: { limit?: number; offset?: number } = {},
  ): Promise<PublicAuthorProfile> {
    const handle = encodeURIComponent(username.replace(/^@/, ''));
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    return this.request<PublicAuthorProfile>(`feed/public/authors/${handle}?${params.toString()}`);
  }

  async lookupPublication(assetType: AssetType, assetId: string): Promise<PublicationLookupResult> {
    const params = new URLSearchParams();
    params.set('assetType', assetType);
    params.set('assetId', assetId);
    return this.request<PublicationLookupResult>(`feed/publications/lookup?${params.toString()}`);
  }

  async getDigestPreview(periodDays = 7, limit = 8): Promise<DigestPreviewResult> {
    const params = new URLSearchParams();
    params.set('periodDays', String(periodDays));
    params.set('limit', String(limit));
    return this.request<DigestPreviewResult>(`feed/public/digest/preview?${params.toString()}`);
  }

  async subscribeDigest(email: string): Promise<{ success: boolean; message: string }> {
    return this.request(`feed/public/digest/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  }

  async unsubscribeDigest(token: string): Promise<{ success: boolean; message: string }> {
    const params = new URLSearchParams();
    params.set('token', token);
    return this.request(`feed/public/digest/unsubscribe?${params.toString()}`, {
      method: 'POST',
    });
  }

  async getPublicItemById(itemId: string): Promise<FeedItem | null> {
    try {
      return await this.request<FeedItem>(`feed/public/${itemId}`);
    } catch {
      return null;
    }
  }

  async trackPublicView(itemId: string, referralCode?: string | null): Promise<void> {
    try {
      const body: Record<string, unknown> = {};
      const ref = referralCode?.trim().replace(/^@/, '');
      if (ref) body.referral_code = ref;
      await this.request(`feed/public/${itemId}/views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      /* best-effort analytics */
    }
  }

  async getSavedFeed(query: Pick<FeedQuery, 'sort' | 'limit' | 'offset'> = {}): Promise<FeedResponse> {
    const params = new URLSearchParams();
    params.set('sort', query.sort || 'recent');
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    return this.request<FeedResponse>(`feed/saved?${params.toString()}`);
  }

  async getCommentedFeed(query: Pick<FeedQuery, 'sort' | 'limit' | 'offset'> = {}): Promise<FeedResponse> {
    const params = new URLSearchParams();
    params.set('sort', query.sort || 'recent');
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    return this.request<FeedResponse>(`feed/commented?${params.toString()}`);
  }

  async getItemById(itemId: string): Promise<FeedItem | null> {
    try {
      return await this.request<FeedItem>(`feed/${itemId}`);
    } catch {
      return null;
    }
  }

  async getFilterOptions(
    scope: FeedScope = 'organization',
    params: { organizationId?: string; projectId?: string; privateProjectOnly?: boolean } = {}
  ): Promise<FeedFilterOptions> {
    const query = new URLSearchParams();
    query.set('scope', scope);
    if (params.organizationId) query.set('organizationId', params.organizationId);
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.privateProjectOnly) query.set('privateProjectOnly', 'true');
    return this.request<FeedFilterOptions>(`feed/filters?${query.toString()}`);
  }

  async getSidebarData(
    scope: FeedScope = 'organization',
    query: FeedSidebarQuery = {}
  ): Promise<FeedSidebarData> {
    const params = new URLSearchParams();
    params.set('scope', scope);
    params.set('timeRange', query.timeRange || 'week');
    params.set('sortBy', query.sortBy || 'popular');
    params.set('leaderboardLimit', String(query.leaderboardLimit ?? 8));
    if (query.contentType && query.contentType !== 'all') {
      params.set('contentType', query.contentType);
    }
    // Without these, 'organization'/'project'/'private+privateProjectOnly'
    // scope silently fell back (server-side) to "every org/project I belong
    // to" instead of the one active in the header — the sidebar never
    // actually respected project/org context at all (see getFeed's
    // buildQuery, which already sent these; this method just never did).
    if (query.organizationId) params.set('organizationId', query.organizationId);
    if (query.projectId) params.set('projectId', query.projectId);
    if (query.privateProjectOnly) params.set('privateProjectOnly', 'true');
    return this.request<FeedSidebarData>(`feed/sidebar?${params.toString()}`);
  }

  async reactToItem(itemId: string, reaction: ReactionType): Promise<FeedReactResult> {
    return this.request<FeedReactResult>(`feed/${itemId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction }),
    });
  }

  async toggleBookmark(itemId: string): Promise<FeedSaveResult> {
    return this.request<FeedSaveResult>(`feed/${itemId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async toggleFollowAuthor(authorId: string): Promise<FeedFollowAuthorResult> {
    return this.request<FeedFollowAuthorResult>(`feed/authors/${authorId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async deleteItem(itemId: string): Promise<FeedDeleteItemResult> {
    return this.request<FeedDeleteItemResult>(`feed/${itemId}`, {
      method: 'DELETE',
    });
  }

  /** Edit a pure-text post's own content (`item.canEdit` gates this - only
   * the author's own "post"-type items, not dashboard/chart/insight/query
   * posts, which are edited by re-publishing instead). */
  async updatePost(itemId: string, description: string, mentionedUsers?: string[]): Promise<FeedUpdatePostResult> {
    return this.request<FeedUpdatePostResult>(`feed/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        mentioned_users: mentionedUsers?.length ? mentionedUsers : undefined,
      }),
    });
  }

  async addComment(
    itemId: string,
    content: string,
    parentCommentId?: string,
    mentionedUsers?: string[],
  ): Promise<FeedAddCommentResult> {
    return this.request<FeedAddCommentResult>(`feed/${itemId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        parent_comment_id: parentCommentId || undefined,
        mentioned_users: mentionedUsers?.length ? mentionedUsers : undefined,
      }),
    });
  }

  async updateComment(itemId: string, commentId: string, content: string): Promise<FeedUpdateCommentResult> {
    return this.request<FeedUpdateCommentResult>(`feed/${itemId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async deleteComment(itemId: string, commentId: string): Promise<FeedDeleteCommentResult> {
    return this.request<FeedDeleteCommentResult>(`feed/${itemId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  async reactToComment(
    itemId: string,
    commentId: string,
    reaction: ReactionType,
  ): Promise<FeedCommentReactResult> {
    return this.request<FeedCommentReactResult>(`feed/${itemId}/comments/${commentId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction }),
    });
  }

  async shareItem(itemId: string): Promise<FeedShareResult> {
    return this.request<FeedShareResult>(`feed/${itemId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async trackView(
    itemId: string,
    payload: { session_id?: string; duration_seconds?: number } = {},
  ): Promise<FeedTrackViewResult> {
    return this.request<FeedTrackViewResult>(`feed/${itemId}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async publishAsset(payload: PublishAssetRequest): Promise<PublishAssetResponse> {
    return this.request<PublishAssetResponse>('feed/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async publishFromChat(payload: PublishFromChatRequest): Promise<PublishAssetResponse> {
    return this.request<PublishAssetResponse>('feed/publications/from-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async updatePublicationSnapshot(
    postId: string,
    payload: UpdateSnapshotRequest,
  ): Promise<PublishAssetResponse> {
    return this.request<PublishAssetResponse>(`feed/publications/${postId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async saveChatFeedDraft(params: {
    conversation_id: string;
    message_id: string;
    draft: Record<string, unknown>;
  }): Promise<{ success: boolean; draft: Record<string, unknown> }> {
    return this.request('feed/drafts/chat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async getChatFeedDraft(
    conversationId: string,
    messageId: string,
  ): Promise<{ success: boolean; draft: Record<string, unknown> }> {
    const query = new URLSearchParams({
      conversationId,
      messageId,
    });
    return this.request(`feed/drafts/chat?${query.toString()}`);
  }

  async getApprovalQueue(params: {
    organizationId?: string;
    projectId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ApprovalQueueResponse> {
    const query = new URLSearchParams();
    query.set('limit', String(params.limit ?? 20));
    query.set('offset', String(params.offset ?? 0));
    if (params.organizationId) query.set('organizationId', params.organizationId);
    if (params.projectId) query.set('projectId', params.projectId);
    return this.request<ApprovalQueueResponse>(`feed/approvals/queue?${query.toString()}`);
  }

  async approvePublication(itemId: string): Promise<ApprovalDecisionResponse> {
    return this.request<ApprovalDecisionResponse>(`feed/approvals/${itemId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async rejectPublication(itemId: string, reason: string): Promise<ApprovalDecisionResponse> {
    return this.request<ApprovalDecisionResponse>(`feed/approvals/${itemId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  }

  async listCollections(): Promise<{
    collections: Array<{
      id: string;
      name: string;
      description?: string | null;
      isPublic?: boolean;
      itemCount?: number;
      createdAt?: string;
      updatedAt?: string;
    }>;
  }> {
    return this.request('feed/collections');
  }

  async createCollection(payload: {
    name: string;
    description?: string;
    organization_id?: string;
    project_id?: string;
    is_public?: boolean;
  }) {
    return this.request('feed/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async updateCollection(
    collectionId: string,
    payload: { name?: string; description?: string; is_public?: boolean },
  ) {
    return this.request(`feed/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async deleteCollection(collectionId: string): Promise<{ success: boolean }> {
    return this.request(`feed/collections/${collectionId}`, { method: 'DELETE' });
  }

  async getCollection(collectionId: string) {
    return this.request(`feed/collections/${collectionId}`);
  }

  async addCollectionItem(collectionId: string, postId: string, note?: string) {
    return this.request(`feed/collections/${collectionId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, note }),
    });
  }

  async removeCollectionItem(collectionId: string, itemId: string): Promise<{ success: boolean }> {
    return this.request(`feed/collections/${collectionId}/items/${itemId}`, {
      method: 'DELETE',
    });
  }
}

export const socialFeedService = new SocialFeedService();
export default socialFeedService;
