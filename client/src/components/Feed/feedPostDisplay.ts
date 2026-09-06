import type { AssetType, FeedItem } from '@/services/socialFeedService';

function isGenericLegacySummary(summary: string, assetType: AssetType): boolean {
  const s = summary.toLowerCase();
  if (s.endsWith(' summary')) return true;
  return s.includes(` - ${assetType} summary`);
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

  const override = descriptionOverride?.trim();
  if (override && !isTitleRepeat(override)) return override;

  const description = item.description?.trim();
  if (description && !isTitleRepeat(description)) return description;

  const excerpt = item.asset?.excerpt?.trim();
  if (excerpt && !isTitleRepeat(excerpt)) return excerpt;

  const summary = item.asset?.summary?.trim();
  if (summary && !isTitleRepeat(summary) && !isGenericLegacySummary(summary, item.assetType)) {
    return summary;
  }

  return '';
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
