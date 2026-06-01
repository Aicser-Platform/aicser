import type { FeedItem } from '@/services/socialFeedService';
import { buildStudioPath } from '@/app/(dashboard)/dashboards/utils/studioNavigation';
import { getChatHref } from '@/utils/appPaths';
import { buildInsightChatUrl } from '@/utils/feedInsightLinks';

export function getFeedAssetPath(item: Pick<FeedItem, 'assetType' | 'assetId' | 'id' | 'asset'>): string {
  switch (item.assetType) {
    case 'dashboard':
      return buildStudioPath(item.assetId);
    case 'chart': {
      const dashboardId = item.asset?.dashboardId;
      if (dashboardId) {
        const params = new URLSearchParams({ id: dashboardId, chart: item.assetId });
        return `/dashboards?${params.toString()}`;
      }
      return `/chart-designer?chart=${encodeURIComponent(item.assetId)}`;
    }
    case 'query': {
      const queryId = item.asset?.sourceQueryId;
      return queryId
        ? `/query-editor?queryId=${encodeURIComponent(queryId)}`
        : '/query-editor';
    }
    case 'insight':
      return buildInsightChatUrl(item);
    default:
      return `/feed/${item.id}`;
  }
}

export function getFeedAskAiPath(
  item: Pick<FeedItem, 'id' | 'assetType' | 'assetId' | 'title' | 'asset'>,
): string {
  if (item.assetType === 'insight') {
    const conversationId = item.asset?.conversationId;
    const messageId = item.asset?.messageId;
    if (conversationId && messageId) {
      return getChatHref({
        conversation: String(conversationId),
        message: String(messageId),
        prompt: `Help me explore this insight: "${item.title}"`,
      });
    }
  }

  const prompt = `Explain this ${item.assetType}: "${item.title}"`;
  return getChatHref({
    feedPostId: item.id,
    prompt,
    ...(item.assetType !== 'insight'
      ? { assetType: item.assetType, assetId: item.assetId }
      : {}),
  });
}

export function canOpenFeedAsset(item: Pick<FeedItem, 'assetType' | 'assetId' | 'visibility'>, isOwner: boolean): boolean {
  if (!item.assetId) return false;
  if (item.assetType === 'insight') return true;
  if (item.visibility === 'private' && !isOwner) return false;
  return true;
}
