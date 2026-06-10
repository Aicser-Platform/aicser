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
}

export function FeedPostContent({
  item,
  titleOverride,
  descriptionOverride,
  className = '',
  compactTitle = false,
}: FeedPostContentProps) {
  const title = (titleOverride ?? item.title).trim();
  const question = resolveFeedPostQuestion(item, title);
  const summary = resolveFeedPostSummary(item, descriptionOverride);

  return (
    <div className={`feed-post-content flex flex-col gap-2 ${className}`.trim()}>
      <Paragraph
        className={`m-0 leading-snug text-[var(--ant-color-text)] ${compactTitle ? 'text-sm font-semibold' : 'text-base font-semibold'}`}
        ellipsis={compactTitle ? { rows: 2 } : false}
      >
        {title}
      </Paragraph>
      {question ? (
        <Text type="secondary" className="text-sm leading-relaxed">
          {question}
        </Text>
      ) : null}
      {summary ? <FeedExpandableText text={summary} maxRows={3} /> : null}
      {(item.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
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
