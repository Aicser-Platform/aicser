'use client';

import React from 'react';
import Link from 'next/link';
import { Avatar, Card, Descriptions, Statistic, Tag, Typography } from 'antd';
import { BankOutlined, CommentOutlined, EyeOutlined, LikeOutlined } from '@ant-design/icons';
import { BookmarkIcon } from '@/components/icons/BookmarkIcon';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';

const { Text, Title } = Typography;

type FeedDetailSidebarProps = {
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

const FeedDetailSidebar: React.FC<FeedDetailSidebarProps> = ({ item, visibilityLabel }) => {
  const t = useTranslations('feed');
  const metrics = [
    { key: 'views', label: t('sidebar_tooltip_views'), value: item.metrics.views, icon: <EyeOutlined /> },
    { key: 'reactions', label: t('sidebar_tooltip_likes'), value: item.metrics.reactions, icon: <LikeOutlined /> },
    { key: 'comments', label: t('sidebar_tooltip_comments'), value: item.metrics.comments, icon: <CommentOutlined /> },
    { key: 'saves', label: t('save'), value: item.metrics.bookmarks, icon: <BookmarkIcon /> },
  ];

  return (
    <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-5 xl:self-start">
      <Card className="border-[var(--ant-color-border-secondary)] shadow-none" styles={{ body: { padding: 20 } }}>
        <Title level={5} className="!mb-4 !mt-0">
          {t('author')}
        </Title>
        {(() => {
          const authorProfileHref = item.author.username
            ? `/discover/author/${encodeURIComponent(item.author.username.replace(/^@/, ''))}`
            : null;
          const authorBlock = (
            <div className="flex items-center gap-3">
              <Avatar
                size={48}
                src={item.author.avatarUrl}
                className={`shrink-0 bg-[var(--ant-color-primary-bg)] font-semibold text-[var(--ant-color-primary)] ${authorProfileHref ? 'cursor-pointer' : ''}`}
              >
                {item.author.name.charAt(0).toUpperCase()}
              </Avatar>
              <div className="min-w-0">
                <Text strong className={`block truncate text-base ${authorProfileHref ? 'hover:text-[var(--ant-color-primary)]' : ''}`}>
                  {item.author.name}
                </Text>
                {item.author.username ? (
                  <Text type="secondary" className="block truncate text-sm">
                    @{item.author.username.replace(/^@/, '')}
                  </Text>
                ) : null}
                {item.author.title ? (
                  // Self-reported profile text (Settings -> Profile -> Company),
                  // not a link to a real org page — this platform's Organization
                  // entities aren't looked up here, so there's nowhere true to
                  // send a click yet. The icon+"at" framing at least reads
                  // unambiguously as an affiliation, not part of the person's
                  // name/handle (previously bare text, easy to misread as such).
                  <Text type="secondary" className="mt-1 flex items-center gap-1 truncate text-xs">
                    <BankOutlined className="shrink-0" />
                    <span className="truncate">at {item.author.title}</span>
                  </Text>
                ) : null}
              </div>
            </div>
          );
          return authorProfileHref ? <Link href={authorProfileHref}>{authorBlock}</Link> : authorBlock;
        })()}
      </Card>

      <Card className="border-[var(--ant-color-border-secondary)] shadow-none" styles={{ body: { padding: 20 } }}>
        <Title level={5} className="!mb-4 !mt-0">
          {t('engagement')}
        </Title>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-3"
            >
              <Statistic
                title={
                  <span className="flex items-center gap-1.5 text-xs">
                    {metric.icon}
                    {metric.label}
                  </span>
                }
                value={metric.value}
                valueStyle={{ fontSize: 20, lineHeight: 1.2, fontWeight: 600 }}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-[var(--ant-color-border-secondary)] shadow-none" styles={{ body: { padding: 20 } }}>
        <Title level={5} className="!mb-4 !mt-0">
          {t('publishing')}
        </Title>
        <Descriptions
          column={1}
          colon={false}
          size="small"
          labelStyle={{ color: 'var(--ant-color-text-secondary)', width: 100 }}
          contentStyle={{ textAlign: 'right' }}
          items={[
            {
              key: 'visibility',
              label: t('visibility'),
              children: <Tag className="m-0">{visibilityLabel}</Tag>,
            },
            {
              key: 'published',
              label: t('published'),
              children: formatDate(item.publishedAt),
            },
            {
              key: 'activity',
              label: t('last_activity'),
              children: formatDate(item.lastActivityAt),
            },
            ...(item.isEdited && item.editedAt
              ? [
                  {
                    key: 'edited',
                    label: t('edited_label_short'),
                    children: formatDate(item.editedAt),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </aside>
  );
};

export default FeedDetailSidebar;
