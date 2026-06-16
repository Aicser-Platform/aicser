'use client';

import React from 'react';
import { Avatar, Card, Descriptions, Statistic, Tag, Typography } from 'antd';
import { BookOutlined, CommentOutlined, EyeOutlined, LikeOutlined } from '@ant-design/icons';
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
    { key: 'saves', label: t('save'), value: item.metrics.bookmarks, icon: <BookOutlined /> },
  ];

  return (
    <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-5 xl:self-start">
      <Card className="border-[var(--ant-color-border-secondary)] shadow-none" styles={{ body: { padding: 20 } }}>
        <Title level={5} className="!mb-4 !mt-0">
          {t('author')}
        </Title>
        <div className="flex items-center gap-3">
          <Avatar
            size={48}
            src={item.author.avatarUrl}
            className="shrink-0 bg-[var(--ant-color-primary-bg)] font-semibold text-[var(--ant-color-primary)]"
          >
            {item.author.name.charAt(0).toUpperCase()}
          </Avatar>
          <div className="min-w-0">
            <Text strong className="block truncate text-base">
              {item.author.name}
            </Text>
            {item.author.username ? (
              <Text type="secondary" className="block truncate text-sm">
                @{item.author.username.replace(/^@/, '')}
              </Text>
            ) : null}
            {item.author.title ? (
              <Text type="secondary" className="mt-1 block truncate text-xs">
                {item.author.title}
              </Text>
            ) : null}
          </div>
        </div>
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
          ]}
        />
      </Card>
    </aside>
  );
};

export default FeedDetailSidebar;
