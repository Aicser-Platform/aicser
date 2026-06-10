import type { FeedVisibility } from '@/services/socialFeedService';
import type { ChartData } from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';

export const CHAT_FEED_DRAFT_KEY = 'chat_feed_publish_draft';

export interface ChatFeedChartPreview {
  chartType: string;
  chartData?: ChartData;
  chartOptions?: Record<string, unknown>;
  chartQuery?: Record<string, unknown>;
}

export interface ChatFeedDraft {
  conversationId: string;
  messageId: string;
  title: string;
  questionTitle?: string;
  description?: string;
  excerpt?: string;
  hasChart?: boolean;
  hasSql?: boolean;
  chartPreview?: ChatFeedChartPreview;
  previewMetadata?: Record<string, unknown>;
  snapshotPayload?: Record<string, unknown>;
}

export function writeChatFeedDraft(draft: ChatFeedDraft): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHAT_FEED_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota errors
  }
}

export function readChatFeedDraft(conversationId: string, messageId: string): ChatFeedDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHAT_FEED_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatFeedDraft;
    if (
      String(parsed.conversationId) !== String(conversationId) ||
      String(parsed.messageId) !== String(messageId)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearChatFeedDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CHAT_FEED_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function truncateWithEllipsis(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}…`;
}

export function getQuestionFromThread(
  messages: Array<{ query?: string }>,
  index: number,
): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const q = messages[i]?.query;
    if (typeof q === 'string' && q.trim()) return q.trim();
  }
  return undefined;
}

export function defaultFeedVisibility(
  isEnterprise: boolean,
  projectId?: string | null,
  organizationId?: string | null,
): FeedVisibility {
  if (!isEnterprise) return 'public';
  if (projectId) return 'project';
  if (organizationId) return 'organization';
  return 'private';
}

export function feedPostListUrl(publicationId: string): string {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('feed_highlight_post_id', publicationId);
    } catch {
      // ignore
    }
  }
  return `/feed?post=${encodeURIComponent(publicationId)}`;
}

export function feedPostDetailUrl(publicationId: string): string {
  return `/feed/${publicationId}`;
}
