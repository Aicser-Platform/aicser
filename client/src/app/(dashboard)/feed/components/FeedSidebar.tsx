'use client';

import React from 'react';
import { Button, Card, Empty, List, Select, Space, Typography, Avatar } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  EyeOutlined,
  HeartOutlined,
  MessageOutlined,
  SaveOutlined,
  TrophyOutlined,
  FolderOpenOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { AssetType, FeedSidebarData, LeaderboardSortBy, LeaderboardTimeRange } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

interface FeedSidebarProps {
  data: FeedSidebarData;
  loading?: boolean;
  timeRange: LeaderboardTimeRange;
  contentType: AssetType | 'all';
  sortBy: LeaderboardSortBy;
  onChangeTimeRange: (value: LeaderboardTimeRange) => void;
  onChangeContentType: (value: AssetType | 'all') => void;
  onChangeSortBy: (value: LeaderboardSortBy) => void;
  onOpenItem: (postId: string) => void;
  onLikeItem: (postId: string) => void;
  onSaveItem: (postId: string) => void;
}

const FeedSidebar: React.FC<FeedSidebarProps> = ({
  data,
  loading = false,
  timeRange,
  contentType,
  sortBy,
  onChangeTimeRange,
  onChangeContentType,
  onChangeSortBy,
  onOpenItem,
  onLikeItem,
  onSaveItem,
}) => {
  const t = useTranslations('feed');
  const router = useRouter();

  const trendIcon = (trend: 'up' | 'down' | 'new' | 'stable') => {
    if (trend === 'up') return <ArrowUpOutlined className="text-[var(--ant-color-success)] text-xs" />;
    if (trend === 'down') return <ArrowDownOutlined className="text-[var(--ant-color-error)] text-xs" />;
    if (trend === 'new')
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--ant-color-warning-bg)] text-[var(--ant-color-warning)]">
          {t('trend_badge_new')}
        </span>
      );
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)]">
        {t('trend_badge_stable')}
      </span>
    );
  };

  const getRankStyles = (rank: number) => {
    const base = 'flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0';
    if (rank === 1) return `${base} bg-gradient-to-br from-yellow-300 to-yellow-500 text-white shadow-sm`;
    if (rank === 2) return `${base} bg-gradient-to-br from-gray-200 to-gray-400 text-white shadow-sm`;
    if (rank === 3) return `${base} bg-gradient-to-br from-orange-200 to-orange-400 text-white shadow-sm`;
    return `${base} bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text-secondary)] border border-[var(--ant-color-border)]`;
  };

  const openCollection = (collectionId: string) => {
    if (collectionId === 'saved-items') {
      router.push('/feed/saved');
      return;
    }
    if (collectionId === 'commented-items') {
      router.push('/feed/comments');
      return;
    }
  };

  const cardStyles =
    'bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden';
  const cardHeadStyles = {
    borderBottom: '1px solid var(--ant-color-border-secondary)',
    padding: '16px 20px',
    minHeight: 'auto',
    fontSize: '15px',
  };
  const cardBodyStyles = { padding: '0px' };

  return (
    <div className="flex flex-col gap-5 w-full sticky top-4">
      {/* Leaderboard Card */}
      <Card
        className={cardStyles}
        headStyle={cardHeadStyles}
        bodyStyle={cardBodyStyles}
        title={<span className="font-semibold text-[var(--ant-color-text)]">{t('top_leaderboard')}</span>}
      >
        <div className="p-4 bg-[var(--ant-color-bg-layout)] border-b border-[var(--ant-color-border-secondary)] flex flex-wrap gap-2">
          <Select
            size="small"
            className="min-w-[100px]"
            value={timeRange}
            onChange={onChangeTimeRange}
            options={[
              { label: t('today'), value: 'today' },
              { label: t('this_week'), value: 'week' },
              { label: t('this_month'), value: 'month' },
              { label: t('all_time'), value: 'all' },
            ]}
          />
          <Select
            size="small"
            className="min-w-[110px]"
            value={contentType}
            onChange={onChangeContentType}
            options={[
              { label: t('all_types'), value: 'all' },
              { label: t('dashboards_type'), value: 'dashboard' },
              { label: t('charts_type'), value: 'chart' },
              { label: t('insights_type'), value: 'insight' },
            ]}
          />
          <Select
            size="small"
            className="min-w-[120px]"
            value={sortBy}
            onChange={onChangeSortBy}
            options={[
              { label: t('sort_promoted'), value: 'popular' },
              { label: t('sort_most_voted'), value: 'voted' },
              { label: t('sort_most_viewed'), value: 'viewed' },
              { label: t('sort_discussed'), value: 'discussed' },
            ]}
          />
        </div>

        {(data.leaderboard ?? []).length === 0 && !loading ? (
          <div className="p-8">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<span className="text-[var(--ant-color-text-description)]">{t('no_leaderboard_data')}</span>}
            />
          </div>
        ) : (
          <List
            dataSource={data.leaderboard}
            loading={loading}
            renderItem={(item) => (
              <div
                className="group flex flex-col gap-3 p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)]/80 transition-colors cursor-pointer"
                onClick={() => onOpenItem(item.postId)}
              >
                <div className="flex items-start gap-3">
                  <div className={getRankStyles(item.rank)}>{item.rank}</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--ant-color-text)] leading-tight line-clamp-2 mb-1">
                      {item.title}
                    </h4>
                    <p className="text-xs text-[var(--ant-color-text-secondary)]">
                      {t('leaderboard_by_author')}{' '}
                      <span className="font-medium text-[var(--ant-color-text)]">{item.creator.name}</span>
                    </p>
                  </div>
                  <div className="shrink-0 pt-0.5">{trendIcon(item.trend)}</div>
                </div>

                <div className="flex items-center justify-between mt-1 pl-10">
                  <div className="flex items-center gap-4 text-xs text-[var(--ant-color-text-secondary)] font-medium">
                    <span className="flex items-center gap-1.5" title={t('sidebar_tooltip_views')}>
                      <EyeOutlined className="text-[var(--ant-color-text-description)]" /> {item.viewCount}
                    </span>
                    <span className="flex items-center gap-1.5" title={t('sidebar_tooltip_likes')}>
                      <HeartOutlined className="text-[var(--ant-color-text-description)]" /> {item.voteCount}
                    </span>
                    <span className="flex items-center gap-1.5" title={t('sidebar_tooltip_comments')}>
                      <MessageOutlined className="text-[var(--ant-color-text-description)]" /> {item.commentCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="text"
                      size="small"
                      className="text-[var(--ant-color-text-description)] hover:text-[var(--ant-color-primary)] hover:bg-[var(--ant-color-primary-bg)]"
                      icon={<HeartOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onLikeItem(item.postId);
                      }}
                    />
                    <Button
                      type="text"
                      size="small"
                      className="text-[var(--ant-color-text-description)] hover:text-[var(--ant-color-primary)] hover:bg-[var(--ant-color-primary-bg)]"
                      icon={<SaveOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSaveItem(item.postId);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </Card>

      {/* Top Contributors Card */}
      <Card
        className={cardStyles}
        headStyle={cardHeadStyles}
        bodyStyle={cardBodyStyles}
        title={<span className="font-semibold text-[var(--ant-color-text)]">{t('top_contributors')}</span>}
      >
        <List
          dataSource={data.topContributors ?? []}
          locale={{
            emptyText: <div className="p-4 text-[var(--ant-color-text-description)]">{t('no_contributor_data')}</div>,
          }}
          renderItem={(entry, index) => (
            <div className="flex items-center gap-3 p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors">
              <Avatar
                size={32}
                src={entry.author.avatarUrl}
                className="bg-blue-100 text-[var(--ant-color-primary)] shrink-0"
              >
                {entry.author.name.charAt(0)}
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-[var(--ant-color-text)] truncate">
                    {entry.author.name}
                  </span>
                  {index < 3 && (
                    <TrophyOutlined
                      className={`text-xs ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-[var(--ant-color-text-description)]' : 'text-orange-400'}`}
                    />
                  )}
                </div>
                <div className="text-xs text-[var(--ant-color-text-secondary)]">
                  {t('contributors_posts_engagement', {
                    posts: entry.contributionCount,
                    engagement: entry.engagementScore,
                  })}
                </div>
              </div>
            </div>
          )}
        />
      </Card>

      {/* Collections Card */}
      <Card
        className={cardStyles}
        headStyle={cardHeadStyles}
        bodyStyle={cardBodyStyles}
        title={<span className="font-semibold text-[var(--ant-color-text)]">{t('collections')}</span>}
      >
        <List
          dataSource={data.collections ?? []}
          renderItem={(collection) => (
            <div
              className="flex items-center gap-3 p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors cursor-pointer group"
              onClick={() => openCollection(collection.id)}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                style={{ backgroundColor: `${collection.color}15`, color: collection.color }}
              >
                <FolderOpenOutlined />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--ant-color-text)] group-hover:text-[var(--ant-color-primary)] transition-colors">
                  {collection.name}
                </div>
                <div className="text-xs text-[var(--ant-color-text-secondary)] mt-0.5">
                  {t('collections_n_items', { count: collection.count })}
                </div>
              </div>
            </div>
          )}
        />
      </Card>

      {/* Trending Tags Card */}
      <Card
        className={cardStyles}
        headStyle={cardHeadStyles}
        title={<span className="font-semibold text-[var(--ant-color-text)]">{t('trending_tags')}</span>}
      >
        <div className="flex flex-wrap gap-2">
          {(data.trendingTags ?? []).map((tag) => (
            <div
              key={tag.tag}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--ant-color-bg-layout)] hover:bg-[var(--ant-color-border-secondary)] border border-[var(--ant-color-border)] rounded-full cursor-pointer transition-colors text-sm"
            >
              <span className="text-[var(--ant-color-text-secondary)] font-medium">#{tag.tag}</span>
              <span className="text-xs bg-[var(--ant-color-bg-container)] px-1.5 rounded-full text-[var(--ant-color-text-secondary)] border border-[var(--ant-color-border)]">
                {tag.count}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Latest Activity Card */}
      <Card
        className={cardStyles}
        headStyle={cardHeadStyles}
        bodyStyle={cardBodyStyles}
        title={<span className="font-semibold text-[var(--ant-color-text)]">{t('latest_activity')}</span>}
      >
        <List
          dataSource={data.activity ?? []}
          renderItem={(activity) => (
            <div className="p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors flex gap-3 items-start">
              <Avatar
                size={28}
                className="bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)] shrink-0 mt-0.5"
              >
                {activity.actor.name.charAt(0)}
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--ant-color-text-secondary)] leading-tight">
                  <span className="font-semibold text-[var(--ant-color-text)]">{activity.actor.name}</span>{' '}
                  {activity.action}
                </p>
                <p className="text-sm font-medium text-[var(--ant-color-text)] mt-1 truncate">{activity.title}</p>
                <div className="flex items-center gap-1 mt-1.5 text-[11px] text-[var(--ant-color-text-description)]">
                  <ClockCircleOutlined />
                  <span>{activity.time}</span>
                </div>
              </div>
            </div>
          )}
        />
      </Card>
    </div>
  );
};

export default FeedSidebar;
