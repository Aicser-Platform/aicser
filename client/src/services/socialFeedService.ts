'use client';

import { fetchApi } from '@/utils/api';

export type FeedVisibility = 'private' | 'project' | 'organization' | 'public' | 'following';
export type FeedScope = 'private' | 'organization' | 'project' | 'public' | 'following';
export type FeedSort = 'recommended' | 'trending' | 'recent';
export type AssetType = 'dashboard' | 'chart' | 'insight';
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
}

export interface FeedAssetPreview {
  type: FeedPreviewType;
  data?: number[];
  label?: string;
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
  asset: {
    summary: string;
    previewLabel: string;
    previewType?: FeedPreviewType;
    previewData?: number[];
    previews?: FeedAssetPreview[];
  };
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
  activity: { id: string; actor: FeedAuthor; action: string; assetType: AssetType; title: string; time: string }[];
}

export interface FeedSidebarQuery {
  timeRange?: LeaderboardTimeRange;
  contentType?: AssetType | 'all';
  sortBy?: LeaderboardSortBy;
  leaderboardLimit?: number;
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

export interface PublishAssetRequest {
  asset_type: AssetType;
  asset_id: string;
  organization_id?: string;
  project_id?: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility?: FeedVisibility;
  status?: 'draft' | 'pending' | 'approved' | 'rejected';
  requires_login?: boolean;
  public_access_level?: 'results_only' | 'full_access';
  featured?: boolean;
  featured_until?: string;
}

export interface PublishAssetResponse {
  success: boolean;
  publication_id: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
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
    params: { organizationId?: string; projectId?: string } = {}
  ): Promise<FeedFilterOptions> {
    const query = new URLSearchParams();
    query.set('scope', scope);
    if (params.organizationId) query.set('organizationId', params.organizationId);
    if (params.projectId) query.set('projectId', params.projectId);
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

  async addComment(itemId: string, content: string, parentCommentId?: string): Promise<FeedAddCommentResult> {
    return this.request<FeedAddCommentResult>(`feed/${itemId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        parent_comment_id: parentCommentId || undefined,
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
}

export const socialFeedService = new SocialFeedService();
export default socialFeedService;
