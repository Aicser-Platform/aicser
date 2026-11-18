'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FeedAuthorAvatar } from '@/components/Feed/FeedAuthorAvatar';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';
import type { FeedItem } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';

interface SoftCollapsedFeedPostProps {
  item: FeedItem;
  children: React.ReactNode;
}

/**
 * Soft-collapse ultra-short text posts so they don't compete visually with dashboards/charts, while still remaining
 * one click away.
 */
const SoftCollapsedFeedPost: React.FC<SoftCollapsedFeedPostProps> = ({ item, children }) => {
  const t = useTranslations('feed_page');
  const { name: authorName } = useFeedAuthorDisplay(item.author);
  const [expanded, setExpanded] = useState(false);
  const preview = (item.description || item.title || '').replace(/\s+/g, ' ').trim();

  if (expanded) return <>{children}</>;

  return (
    <button
      type="button"
      id={`feed-post-${item.id}`}
      className="group flex w-full items-center gap-3 rounded-xl border border-dashed bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
      onClick={() => setExpanded(true)}
      aria-label={t('expand_short_post_aria')}
    >
      <FeedAuthorAvatar author={item.author} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{authorName}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatTimeAgo(item.lastActivityAt || item.publishedAt)}
          </span>
        </span>
        <span className="block truncate text-sm text-muted-foreground">{preview || t('short_post_empty_preview')}</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-primary-hover group-hover:underline dark:text-primary">
        {t('expand_short_post')}
      </span>
    </button>
  );
};

export default SoftCollapsedFeedPost;
