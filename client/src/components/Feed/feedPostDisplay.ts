import type { AssetType, FeedItem } from '@/services/socialFeedService';
import {
  extractAssetDisplayTitle,
  feedItemDisplayTitle,
  isWeakDisplayTitle,
} from '@/utils/sanitizeDisplayTitle';

function isGenericLegacySummary(summary: string, assetType: AssetType): boolean {
  const s = summary.toLowerCase();
  if (s.endsWith(' summary')) return true;
  return s.includes(` - ${assetType} summary`);
}

/**
 * True when `short` looks like a clipped copy of `long` (publish used to bake
 * a 320-char ellipsis into description while keeping a fuller excerpt in meta).
 * Prefer the fuller text on detail pages instead of stopping mid-sentence.
 */
export function isLikelyTruncatedFormOf(short: string, long: string): boolean {
  const a = short.trim();
  const b = long.trim();
  if (!a || !b || b.length <= a.length) return false;
  const stripped = a.replace(/(?:\u2026|\.\.\.)\s*$/u, '').trimEnd();
  if (!stripped || !b.startsWith(stripped)) return false;
  if (/(?:\u2026|\.\.\.)\s*$/u.test(a)) return true;
  // Historical Share-to-Feed clip length
  if (a.length >= 280 && a.length <= 340) return true;
  return b.length - stripped.length >= 40;
}

/** Resolve the text body shown under the title (user desc → excerpt → legacy summary). */
export function resolveFeedPostSummary(item: FeedItem, descriptionOverride?: string): string {
  const title = item.title?.trim().toLowerCase();
  // A candidate that's just a repeat of the title (a chart left at its
  // default, un-customized name - e.g. "Line" - flows unchanged into the
  // backend's own last-resort `summary: description or title` fallback,
  // see service_preview.py) reads as a literal duplicate under the title,
  // not real content. Same "don't show it if it just repeats the title"
  // rule resolveFeedPostQuestion already applies just below.
  const isTitleRepeat = (candidate: string) => Boolean(title) && candidate.trim().toLowerCase() === title;

  const pick = (): string => {
    const override = descriptionOverride?.trim();
    if (override && !isTitleRepeat(override)) return override;

    const description = item.description?.trim();
    const excerpt = item.asset?.excerpt?.trim();

    if (description && !isTitleRepeat(description)) {
      // Prefer the fuller narration when description is only the clipped teaser.
      if (excerpt && !isTitleRepeat(excerpt) && isLikelyTruncatedFormOf(description, excerpt)) {
        return excerpt;
      }
      return description;
    }

    if (excerpt && !isTitleRepeat(excerpt)) return excerpt;

    const summary = item.asset?.summary?.trim();
    if (summary && !isTitleRepeat(summary) && !isGenericLegacySummary(summary, item.assetType)) {
      return summary;
    }

    return '';
  };

  const resolved = pick();
  // Visual cards already have a title + chart; 1–3 character leftovers ("df")
  // are composer noise, not a caption.
  if (isVisualFeedAsset(item.assetType) && resolved.replace(/\s+/g, '').length < 4) {
    return '';
  }
  return resolved;
}

export function resolveFeedPostQuestion(item: FeedItem, titleOverride?: string): string | undefined {
  const question = item.asset?.questionTitle?.trim();
  if (!question) return undefined;
  const title = (titleOverride ?? item.title).trim();
  return question !== title ? question : undefined;
}

/** True for pure text/discussion posts — these render full-width with an
 * inline comment thread (FeedCard) instead of a thumbnail grid tile
 * (FeedGridCard), since there is no visual asset to browse and the whole
 * point is to read/join the discussion without leaving the feed. */
export function isTextPostItem(item: FeedItem): boolean {
  return item.assetType === 'post';
}

/** Chart / dashboard / insight assets, or text posts that attach one. */
export function isInsightFeedItem(item: FeedItem): boolean {
  if (item.assetType !== 'post') return true;
  return Boolean(item.attachments?.some((a) => !a.restricted && a.referencedPostId));
}

/**
 * Ultra-short text-only posts ("d", "hel") that tank feed quality when shown
 * at full weight next to dashboards. Soft-collapse in the stream.
 */
export function isNoiseTextPost(item: FeedItem, minMeaningfulChars = 12): boolean {
  if (!isTextPostItem(item)) return false;
  if (isInsightFeedItem(item)) return false;
  const body = (item.description || item.title || '').replace(/\s+/g, ' ').trim();
  return body.length > 0 && body.length < minMeaningfulChars;
}

/** Chart / dashboard / insight posts render a live visual instead of a still. */
export function isVisualFeedAsset(assetType: AssetType): boolean {
  return assetType === 'dashboard' || assetType === 'chart' || assetType === 'insight';
}

const GENERIC_ASSET_TAGS = new Set([
  'analytics',
  'chart',
  'dashboard',
  'insights',
  'insight',
  'query',
  'post',
]);

/**
 * Tags shown under a post. Chart/dashboard/insight cards drop generic type
 * labels ("Analytics", "Chart", …) that waste a line without adding meaning.
 */
export function visibleFeedTags(tags: string[] | undefined, assetType: AssetType): string[] {
  const list = Array.isArray(tags) ? tags : [];
  if (!isVisualFeedAsset(assetType)) return list;
  return list.filter((tag) => !GENERIC_ASSET_TAGS.has(tag.trim().toLowerCase()));
}

export function showFeedAssetTypeBadge(assetType: AssetType): boolean {
  return !isVisualFeedAsset(assetType);
}

/**
 * Title shown above a feed visual. Hide generic labels ("Analytics", "Chart")
 * and titles that already appear inside the live chart so the card is one
 * heading + the viz, not a stacked type line.
 */
export function resolveFeedCardHeading(
  item: Pick<FeedItem, 'title' | 'asset' | 'assetType'>,
  visualItem?: Pick<FeedItem, 'asset'>,
): string {
  const display = feedItemDisplayTitle(item);
  if (!display) return '';
  const inVisual = extractAssetDisplayTitle(visualItem?.asset ?? item.asset);
  if (inVisual && display.trim().toLowerCase() === inVisual.trim().toLowerCase()) {
    return '';
  }
  if (isWeakDisplayTitle(item.title) && inVisual) {
    return '';
  }
  return display;
}

export function feedItemHasLiveVisual(item: Pick<FeedItem, 'asset' | 'assetType' | 'renderMode'>): boolean {
  const asset = item.asset;
  if (!asset) return false;
  if (asset.snapshotPayload) return true;
  if (asset.chartWidget?.chartType) return true;
  if (asset.dashboardId) return true;
  if (item.assetType === 'dashboard' && item.renderMode === 'snapshot') return true;
  if (Array.isArray(asset.previewData) && asset.previewData.length > 0) return true;
  return Boolean(asset.previews?.some((preview) => (preview.data?.length ?? 0) > 0));
}

export function assetTypeLabelKey(assetType: AssetType): string {
  switch (assetType) {
    case 'dashboard':
      return 'badge_type_dashboard';
    case 'chart':
      return 'badge_type_chart';
    case 'insight':
      return 'insights_type';
    case 'query':
      return 'query_type';
    case 'post':
      return 'badge_type_post';
    default:
      return 'badge_type_chart';
  }
}

/** Build a FeedItem-shaped object for publish preview / FeedPreviewVisual. */
export function buildPreviewFeedItem(params: {
  assetType: AssetType;
  assetId?: string;
  title: string;
  description?: string;
  questionTitle?: string;
  excerpt?: string;
  tags?: string[];
  previewMetadata?: Record<string, unknown>;
  chartPreview?: {
    chartType: string;
    chartData?: Record<string, unknown>;
    chartOptions?: Record<string, unknown>;
    chartQuery?: Record<string, unknown>;
  };
  renderMode?: FeedItem['renderMode'];
  snapshotPayload?: Record<string, unknown>;
}): FeedItem {
  const meta = params.previewMetadata ?? {};
  const chartWidget =
    params.chartPreview ||
    (meta.chartWidget as FeedItem['asset']['chartWidget']) ||
    undefined;

  return {
    id: 'publish-preview',
    assetType: params.assetType,
    assetId: params.assetId || 'preview',
    title: params.title,
    description: params.description || '',
    tags: params.tags ?? [],
    visibility: 'public',
    approvalStatus: 'approved',
    publishedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    author: {
      id: 'preview',
      name: 'You',
      username: 'you',
      avatarUrl: undefined,
    },
    metrics: { views: 0, comments: 0, reactions: 0, bookmarks: 0, shares: 0 },
    userInteraction: { isBookmarked: false },
    recentComments: [],
    renderMode: params.renderMode,
    asset: {
      summary: params.description || params.excerpt || params.title,
      previewLabel: params.title,
      previewType: (meta.previewType as FeedItem['asset']['previewType']) || undefined,
      previewData: (meta.previewData as number[]) || undefined,
      previews: (meta.previews as FeedItem['asset']['previews']) || undefined,
      chartWidget,
      dashboardId: meta.dashboardId as string | undefined,
      sourceQueryId: meta.sourceQueryId as string | undefined,
      excerpt: params.excerpt,
      questionTitle: params.questionTitle,
      conversationId: meta.conversationId as string | undefined,
      messageId: meta.messageId as string | undefined,
      snapshotPayload: params.snapshotPayload,
    },
  };
}

/**
 * Accurately check whether the active user is the author/owner of a feed post.
 * Handles:
 * - Direct backend boolean flag (`item.isOwner`)
 * - Primary user id match (`user.id === author.id`)
 * - Auth provider / Supabase id match (`user.user_id === author.id`)
 * - Normalized username handle equality
 * - Synthetic username fallback generated by serialization (e.g., `email_prefix-1a2b3c4d`)
 * - Matching author display name and user display name / email
 */
export function isFeedPostAuthor(
  item?: { author?: { id?: string; username?: string; name?: string }; isOwner?: boolean } | null,
  user?: { id?: string; user_id?: string; email?: string; username?: string; name?: string } | null
): boolean {
  if (!item) return false;
  if (Boolean(item.isOwner)) return true;
  if (!user) return false;

  const authorId = (item.author?.id || '').trim().toLowerCase();
  const userId = (user.id || '').trim().toLowerCase();
  const userAuthId = (user.user_id || '').trim().toLowerCase();

  if (authorId && (authorId === userId || (userAuthId && authorId === userAuthId))) {
    return true;
  }

  const cleanHandle = (h?: string) => (h || '').trim().replace(/^@/, '').toLowerCase();
  const authorHandle = cleanHandle(item.author?.username);
  const userHandle = cleanHandle(user.username);
  if (authorHandle && userHandle && authorHandle === userHandle) {
    return true;
  }

  // Handle synthetic fallback usernames like "makara-1a2b3c4d" generated from email
  if (user.email && authorHandle) {
    const emailPrefix = cleanHandle(user.email.split('@')[0]);
    if (emailPrefix && (authorHandle === emailPrefix || authorHandle.startsWith(`${emailPrefix}-`))) {
      return true;
    }
  }

  // Handle matching display names
  const authorName = (item.author?.name || '').trim().toLowerCase();
  const userName = (user.name || '').trim().toLowerCase();
  if (authorName && userName && authorName === userName) {
    return true;
  }

  // Handle matching email to author name or handle
  if (user.email) {
    const userEmail = user.email.trim().toLowerCase();
    if (authorName && userEmail === authorName) return true;
    if (authorHandle && cleanHandle(userEmail) === authorHandle) return true;
  }

  return false;
}

