'use client';

import React, { useState } from 'react';
import { Avatar, Button } from 'antd';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';

interface SoftCollapsedFeedPostProps {
  item: FeedItem;
  children: React.ReactNode;
}

/**
 * Soft-collapse ultra-short text posts so they don't compete visually with
 * dashboards/charts, while still remaining one click away.
 */
const SoftCollapsedFeedPost: React.FC<SoftCollapsedFeedPostProps> = ({ item, children }) => {
  const t = useTranslations('feed_page');
  const { avatarUrl: authorAvatarUrl, name: authorName } = useFeedAuthorDisplay(item.author);
  const [expanded, setExpanded] = useState(false);
  const preview = (item.description || item.title || '').replace(/\s+/g, ' ').trim();

  if (expanded) return <>{children}</>;

  return (
    <button
      type="button"
      id={`feed-post-${item.id}`}
      className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] px-3 py-2.5 text-left transition-colors hover:border-[var(--ant-color-primary-border)] hover:bg-[var(--ant-color-primary-bg)]"
      onClick={() => setExpanded(true)}
      aria-label={t('expand_short_post_aria')}
    >
      <Avatar
        size={28}
        src={authorAvatarUrl}
        className="shrink-0 bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] text-xs font-medium"
      >
        {authorName.charAt(0).toUpperCase()}
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-[var(--ant-color-text)]">{authorName}</span>
          <span className="shrink-0 text-[11px] text-[var(--ant-color-text-tertiary)]">
            {formatTimeAgo(item.lastActivityAt || item.publishedAt)}
          </span>
        </div>
        <p className="m-0 truncate text-sm text-[var(--ant-color-text-secondary)]">
          {preview || t('short_post_empty_preview')}
        </p>
      </div>
      <Button
        type="link"
        size="small"
        className="shrink-0 px-0 font-medium"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
      >
        {t('expand_short_post')}
      </Button>
    </button>
  );
};

export default SoftCollapsedFeedPost;
