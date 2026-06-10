import type { FeedItem } from '@/services/socialFeedService';
import { getChatHref } from '@/utils/appPaths';

export function buildInsightChatUrl(item: Pick<FeedItem, 'id' | 'asset'>): string {
  const conversationId = item.asset?.conversationId;
  const messageId = item.asset?.messageId;
  if (conversationId && messageId) {
    return getChatHref({
      conversation: String(conversationId),
      message: String(messageId),
    });
  }
  return getChatHref({ feedPostId: item.id });
}
