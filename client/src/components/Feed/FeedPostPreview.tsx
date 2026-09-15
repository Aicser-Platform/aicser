'use client';

import React, { useMemo } from 'react';
import { Avatar, Tag } from 'antd';
import { BarChartOutlined, CodeOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { AssetType, FeedItem } from '@/services/socialFeedService';
import FeedPreviewVisual from '@/app/(dashboard)/feed/components/FeedPreviewVisual';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { assetTypeLabelKey, buildPreviewFeedItem, showFeedAssetTypeBadge } from '@/components/Feed/feedPostDisplay';
import type { FeedPublishDraft } from '@/components/Feed/feedPublishDraft';

export interface FeedPostPreviewProps {
  draft: FeedPublishDraft;
  title: string;
  description?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string | null;
  compact?: boolean;
}

export function FeedPostPreview({
  draft,
  title,
  description,
  authorName,
  authorHandle,
  authorAvatarUrl,
  compact = false,
}: FeedPostPreviewProps) {
  const t = useTranslations('feed_publish_page');
  const tf = useTranslations('feed');

  const previewItem = useMemo((): FeedItem => {
    const assetId =
      draft.source.mode === 'asset' ? draft.source.assetId || draft.source.sourceQueryId : undefined;
    return buildPreviewFeedItem({
      assetType: draft.assetType,
      assetId,
      title: title.trim() || draft.title,
      description,
      questionTitle: draft.questionTitle,
      excerpt: description?.trim() ? undefined : draft.excerpt,
      tags: draft.defaultTags,
      previewMetadata: draft.previewMetadata,
      chartPreview: draft.chartPreview as {
        chartType: string;
        chartData?: Record<string, unknown>;
        chartOptions?: Record<string, unknown>;
        chartQuery?: Record<string, unknown>;
      } | undefined,
      renderMode: draft.renderMode,
      snapshotPayload: draft.snapshotPayload,
    });
  }, [draft, title, description]);

  const assetType: AssetType = draft.assetType;
  const typeLabel = tf(assetTypeLabelKey(assetType) as 'insights_type');
  const showTypeBadge = showFeedAssetTypeBadge(assetType);

  return (
    <div className="feed-post-preview">
      <div className="feed-publish-preview-label">{t('preview_label')}</div>

      <div className="feed-publish-author">
        <Avatar size={36} className="feed-publish-author-avatar" src={authorAvatarUrl || undefined}>
          {authorName.charAt(0).toUpperCase()}
        </Avatar>
        <div>
          <div className="feed-publish-author-name">{authorName}</div>
          {authorHandle ? <div className="feed-publish-author-handle">@{authorHandle}</div> : null}
        </div>
      </div>

      <FeedPostContent
        item={previewItem}
        titleOverride={title.trim() || draft.title}
        descriptionOverride={description}
        compactTitle
      />

      {showTypeBadge || draft.hasChart || draft.hasSql ? (
        <div className="feed-publish-preview-badges">
          {showTypeBadge ? <Tag>{typeLabel}</Tag> : null}
          {draft.hasChart ? (
            <Tag icon={<BarChartOutlined />} color="blue">
              {t('includes_chart')}
            </Tag>
          ) : null}
          {draft.hasSql ? (
            <Tag icon={<CodeOutlined />} color="geekblue">
              SQL
            </Tag>
          ) : null}
        </div>
      ) : null}

      <div
        className={`feed-post-preview-visual ${compact ? 'feed-post-preview-visual--compact' : ''} ${
          assetType === 'dashboard' ? 'feed-post-preview-visual--dashboard' : ''
        }`}
      >
        <FeedPreviewVisual item={previewItem} maxPreviews={4} showOverflowBadge={compact} />
      </div>
    </div>
  );
}

export default FeedPostPreview;
