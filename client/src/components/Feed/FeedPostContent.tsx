'use client';

import React from 'react';
import { Typography } from 'antd';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedExpandableText } from '@/components/Feed/FeedExpandableText';
import { renderTextWithMentions } from '@/components/Feed/MentionText';
import {
  resolveFeedCardHeading,
  resolveFeedPostQuestion,
  resolveFeedPostSummary,
  visibleFeedTags,
} from '@/components/Feed/feedPostDisplay';
import { feedItemDisplayDescription } from '@/utils/sanitizeDisplayTitle';

const { Paragraph, Text } = Typography;

export interface FeedPostContentProps {
  item: FeedItem;
  titleOverride?: string;
  descriptionOverride?: string;
  className?: string;
  compactTitle?: boolean;
  /** Clamp the description to this many rows (default 3; grid cards pass 2 for consistent height). */
  descriptionMaxRows?: number;
  /**
   * `card` — teaser with row clamp / See more.
   * `detail` — full narration (no clamp); use on /feed/[id] and discover detail.
   */
  variant?: 'card' | 'detail';
  /** When false, omit the heading (detail pages often render their own Title). */
  showTitle?: boolean;
}

export function FeedPostContent({
  item,
  titleOverride,
  descriptionOverride,
  className = '',
  compactTitle = false,
  descriptionMaxRows = 3,
  variant = 'card',
  showTitle = true,
}: FeedPostContentProps) {
  const isDetail = variant === 'detail';
  const title = (
    titleOverride
      ? resolveFeedCardHeading({ ...item, title: titleOverride })
      : resolveFeedCardHeading(item)
  ).trim();
  const question = resolveFeedPostQuestion(item, title || item.title);
  const summary = feedItemDisplayDescription(resolveFeedPostSummary(item, descriptionOverride));
  const tags = visibleFeedTags(item.tags, item.assetType);

  return (
    <div className={`feed-post-content flex flex-col ${isDetail ? 'gap-2' : ''} ${className}`.trim()}>
      {showTitle && title ? (
        <Paragraph
          className={`leading-snug text-[var(--ant-color-text)] ${compactTitle ? 'text-sm font-semibold' : 'text-base font-semibold'}`}
          ellipsis={compactTitle && !isDetail ? { rows: 2 } : false}
        >
          {title}
        </Paragraph>
      ) : null}
      {question ? (
        <Text
          type="secondary"
          className={`text-sm leading-relaxed ${isDetail ? 'whitespace-pre-line' : 'line-clamp-2'}`}
        >
          {question}
        </Text>
      ) : null}
      {summary ? (
        isDetail ? (
          <Paragraph
            type="secondary"
            className="!mb-0 !mt-0 max-w-3xl !text-sm !leading-6 whitespace-pre-line"
          >
            {renderTextWithMentions(summary)}
          </Paragraph>
        ) : (
          <FeedExpandableText text={summary} maxRows={descriptionMaxRows} />
        )
      ) : null}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-x-2">
          {tags.map((tag) => (
            <span key={tag} className="text-[13px] font-medium text-[var(--ant-color-primary)]">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default FeedPostContent;
