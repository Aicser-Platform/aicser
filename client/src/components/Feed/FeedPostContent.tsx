'use client';

import React from 'react';
import { Typography } from 'antd';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedExpandableText } from '@/components/Feed/FeedExpandableText';
import { resolveFeedPostQuestion, resolveFeedPostSummary } from '@/components/Feed/feedPostDisplay';

const { Paragraph, Text } = Typography;

export interface FeedPostContentProps {
  item: FeedItem;
  titleOverride?: string;
  descriptionOverride?: string;
  className?: string;
  compactTitle?: boolean;
  /** Clamp the description to this many rows (default 3; grid cards pass 2 for consistent height). */
  descriptionMaxRows?: number;
}

export function FeedPostContent({
  item,
  titleOverride,
  descriptionOverride,
  className = '',
  compactTitle = false,
  descriptionMaxRows = 3,
}: FeedPostContentProps) {
  const title = (titleOverride ?? item.title).trim();
  const question = resolveFeedPostQuestion(item, title);
  const summary = resolveFeedPostSummary(item, descriptionOverride);

  return (
    <div className={`feed-post-content flex flex-col ${className}`.trim()}>
      <Paragraph
        className={`leading-snug text-[var(--ant-color-text)] ${compactTitle ? 'text-sm font-semibold' : 'text-base font-semibold'}`}
        ellipsis={compactTitle ? { rows: 2 } : false}
      >
        {title}
      </Paragraph>
      {question ? (
        <Text type="secondary" className="text-sm leading-relaxed line-clamp-2">
          {question}
        </Text>
      ) : null}
      {summary ? <FeedExpandableText text={summary} maxRows={descriptionMaxRows} /> : null}
      {(item.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="text-[13px] font-medium text-[var(--ant-color-primary)]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default FeedPostContent;
