import type { AssetType } from '@/services/socialFeedService';
import type { ChatFeedChartPreview, ChatFeedDraft } from './chatFeedDraft';

export type FeedPublishSource =
  | { mode: 'chat'; conversationId: string; messageId: string }
  | { mode: 'asset'; assetType: AssetType; assetId?: string; sourceQueryId?: string };

export interface FeedPublishDraft {
  assetType: AssetType;
  source: FeedPublishSource;
  title: string;
  questionTitle?: string;
  excerpt?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  hasChart?: boolean;
  hasSql?: boolean;
  chartPreview?: ChatFeedChartPreview;
  previewMetadata?: Record<string, unknown>;
  snapshotPayload?: Record<string, unknown>;
  renderMode?: 'snapshot' | 'live';
  /** When re-publishing an asset that already has a feed post. */
  existingPublicationId?: string;
  existingPublicationTitle?: string;
  /** CSS selector for the live element to screenshot for the feed card thumbnail. */
  captureSelector?: string;
}

export function chatDraftToPublishDraft(draft: ChatFeedDraft, captureSelector?: string): FeedPublishDraft {
  return {
    assetType: 'insight',
    source: { mode: 'chat', conversationId: draft.conversationId, messageId: draft.messageId },
    title: draft.title,
    questionTitle: draft.questionTitle,
    excerpt: draft.excerpt,
    defaultDescription: draft.description,
    hasChart: draft.hasChart,
    hasSql: draft.hasSql,
    chartPreview: draft.chartPreview,
    previewMetadata: draft.previewMetadata,
    snapshotPayload: draft.snapshotPayload,
    renderMode: 'snapshot',
    captureSelector,
  };
}

export function assetPublishDraft(params: {
  assetType: AssetType;
  assetId?: string;
  sourceQueryId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  previewMetadata?: Record<string, unknown>;
  snapshotPayload?: Record<string, unknown>;
  renderMode?: 'snapshot' | 'live';
  chartPreview?: ChatFeedChartPreview;
  chatPublish?: { conversationId: string; messageId: string };
  existingPublicationId?: string;
  existingPublicationTitle?: string;
  captureSelector?: string;
}): FeedPublishDraft {
  if (params.chatPublish) {
    return {
      assetType: 'insight',
      source: {
        mode: 'chat',
        conversationId: params.chatPublish.conversationId,
        messageId: params.chatPublish.messageId,
      },
      title: params.title || '',
      defaultDescription: params.description,
      defaultTags: params.tags,
      previewMetadata: params.previewMetadata,
      chartPreview: params.chartPreview,
      snapshotPayload: params.snapshotPayload,
      renderMode: params.renderMode ?? 'snapshot',
      captureSelector: params.captureSelector,
    };
  }

  return {
    assetType: params.assetType,
    source: {
      mode: 'asset',
      assetType: params.assetType,
      assetId: params.assetId,
      sourceQueryId: params.sourceQueryId,
    },
    title: params.title || '',
    defaultDescription: params.description,
    defaultTags: params.tags,
    previewMetadata: params.previewMetadata,
    snapshotPayload: params.snapshotPayload,
    renderMode: params.renderMode ?? 'snapshot',
    chartPreview: params.chartPreview,
    hasChart: params.assetType === 'chart' || Boolean(params.chartPreview),
    hasSql: params.assetType === 'query',
    existingPublicationId: params.existingPublicationId,
    existingPublicationTitle: params.existingPublicationTitle,
    captureSelector: params.captureSelector,
  };
}
