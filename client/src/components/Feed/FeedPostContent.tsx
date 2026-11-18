'use client';

import React from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { cn } from '@/lib/ui/utils';
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

/** A post's title, question, summary and tags (Aicser UI; scoped itself: it also renders in the share dialog). */
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
    titleOverride ? resolveFeedCardHeading({ ...item, title: titleOverride }) : resolveFeedCardHeading(item)
  ).trim();
  const question = resolveFeedPostQuestion(item, title || item.title);
  const summary = feedItemDisplayDescription(resolveFeedPostSummary(item, descriptionOverride));
  const tags = visibleFeedTags(item.tags, item.assetType);

  return (
    <AicserUi>
      <div className={cn('feed-post-content flex flex-col gap-1.5', className)}>
        {showTitle && title ? (
          <p
            className={cn(
              'm-0 font-semibold leading-snug text-foreground',
              compactTitle ? 'text-sm' : 'text-base',
              compactTitle && !isDetail && 'line-clamp-2'
            )}
          >
            {title}
          </p>
        ) : null}
        {question ? (
          <p
            className={cn(
              'm-0 text-sm leading-relaxed text-muted-foreground',
              isDetail ? 'whitespace-pre-line' : 'line-clamp-2'
            )}
          >
            {question}
          </p>
        ) : null}
        {summary ? (
          isDetail ? (
            <p className="m-0 max-w-3xl whitespace-pre-line text-sm leading-6 text-muted-foreground">
              {renderTextWithMentions(summary)}
            </p>
          ) : (
            <FeedExpandableText text={summary} maxRows={descriptionMaxRows} />
          )
        ) : null}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-x-2">
            {tags.map((tag) => (
              <span key={tag} className="text-[13px] font-medium text-primary-hover dark:text-primary">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </AicserUi>
  );
}

export default FeedPostContent;
