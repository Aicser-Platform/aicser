'use client';

import React from 'react';
import Link from 'next/link';
import { Avatar, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';

const { Text } = Typography;

type FeedDetailBylineProps = {
  item: FeedItem;
  visibilityLabel: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * LinkedIn-style identity line: who posted, audience, when.
 * Engagement lives in the action bar under the canvas, not here.
 */
const FeedDetailByline: React.FC<FeedDetailBylineProps> = ({ item, visibilityLabel }) => {
  const t = useTranslations('feed');
  const { avatarUrl: authorAvatarUrl, name: authorName } = useFeedAuthorDisplay(item.author);
  const authorProfileHref = item.author.username
    ? `/discover/author/${encodeURIComponent(item.author.username.replace(/^@/, ''))}`
    : null;
  const handle = item.author.username ? `@${item.author.username.replace(/^@/, '')}` : null;

  const nameBlock = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar
        size={32}
        src={authorAvatarUrl}
        className="shrink-0 bg-[var(--ant-color-primary-bg)] text-xs font-semibold text-[var(--ant-color-primary)]"
      >
        {authorName.charAt(0).toUpperCase()}
      </Avatar>
      <span className="min-w-0 truncate">
        <Text strong className="text-sm">
          {authorName}
        </Text>
        {handle ? (
          <Text type="secondary" className="ml-1.5 text-xs">
            {handle}
          </Text>
        ) : null}
      </span>
    </span>
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--ant-color-text-secondary)]">
      {authorProfileHref ? (
        <Link href={authorProfileHref} className="min-w-0 hover:text-[var(--ant-color-primary)]">
          {nameBlock}
        </Link>
      ) : (
        nameBlock
      )}
      <span aria-hidden className="text-[var(--ant-color-text-quaternary)]">
        ·
      </span>
      <span>{visibilityLabel}</span>
      <span aria-hidden className="text-[var(--ant-color-text-quaternary)]">
        ·
      </span>
      <span>{formatDate(item.publishedAt)}</span>
      {item.isEdited && item.editedAt ? (
        <>
          <span aria-hidden className="text-[var(--ant-color-text-quaternary)]">
            ·
          </span>
          <span>
            {t('edited_label_short')} {formatDate(item.editedAt)}
          </span>
        </>
      ) : null}
    </div>
  );
};

export default FeedDetailByline;
