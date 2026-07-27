'use client';

import React, { useState } from 'react';
import { Button, Card, Empty, Input, List, Modal, Select, Space, Typography, Avatar, message, Tooltip, Dropdown } from 'antd';
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
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { AssetType, FeedSidebarData, LeaderboardSortBy, LeaderboardTimeRange } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { useQueryClient } from '@tanstack/react-query';

const { Text } = Typography;

const SYNTHETIC_COLLECTION_IDS = new Set(['saved-items', 'commented-items']);

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
  onTagClick?: (tag: string) => void;
  showRecommended?: boolean;
  onCollectionsChanged?: () => void;
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
  onTagClick,
  showRecommended = true,
  onCollectionsChanged,
}) => {
  const t = useTranslations('feed');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [activeCollection, setActiveCollection] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCollections = () => {
    onCollectionsChanged?.();
    void queryClient.invalidateQueries({ queryKey: ['feed', 'sidebar'] });
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
    router.push(`/feed/collections/${collectionId}`);
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await socialFeedService.createCollection({ name });
      message.success(t('collection_created'));
      setCreateOpen(false);
      setDraftName('');
      refreshCollections();
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!activeCollection) return;
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await socialFeedService.updateCollection(activeCollection.id, { name });
      message.success(t('collection_renamed'));
      setRenameOpen(false);
      setActiveCollection(null);
      refreshCollections();
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCollection = (collection: { id: string; name: string }) => {
    Modal.confirm({
      title: t('collection_delete_title', { name: collection.name }),
      content: t('collection_delete_body'),
      okText: t('collection_delete'),
      okType: 'danger',
      onOk: async () => {
        try {
          await socialFeedService.deleteCollection(collection.id);
          message.success(t('collection_deleted'));
          refreshCollections();
        } catch (err) {
          message.error(formatApiValidationError(err));
          throw err;
        }
      },
    });
  };

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

  const formatActivityAction = (action: string) => {
    const key = `activity_action_${action}`;
    try {
      const label = t(key as 'latest_activity');
      if (label && label !== key) return label;
    } catch {
      // fall through
    }
    return action.replace(/_/g, ' ');
  };

  const cardStyles =
    'bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-none rounded-lg overflow-hidden';
  const cardHeadStyles = {
    borderBottom: '1px solid var(--ant-color-border-secondary)',
    padding: '12px 16px',
    minHeight: 'auto',
    fontSize: '14px',
  };
  const cardBodyStyles = { padding: '0px' };
  const cardStylesProp = { header: cardHeadStyles, body: cardBodyStyles };

  return (
    <div className="flex flex-col gap-4 w-full sticky top-4">
      {/* Leaderboard Card */}
      <Card
        className={cardStyles}
        styles={cardStylesProp}
        title={<span className="font-medium text-[var(--ant-color-text)]">{t('top_leaderboard')}</span>}
      >
        <div className="p-3 bg-[var(--ant-color-bg-layout)] border-b border-[var(--ant-color-border-secondary)] flex flex-wrap gap-1.5">
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
                    <p className="text-xs text-[var(--ant-color-text-secondary)] truncate">
                      {item.creator.name}
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

      {showRecommended && (data.recommended ?? []).length > 0 && (
        <Card
          className={cardStyles}
          styles={cardStylesProp}
          title={<span className="font-medium text-[var(--ant-color-text)]">{t('recommended_for_you')}</span>}
        >
          <List
            dataSource={data.recommended}
            renderItem={(entry) => (
              <div
                className="flex flex-col gap-1 p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors cursor-pointer"
                onClick={() => onOpenItem(entry.postId)}
              >
                <span className="text-sm font-medium text-[var(--ant-color-text)] line-clamp-2">{entry.title}</span>
                <span className="text-xs text-[var(--ant-color-text-description)]">{entry.creator.name}</span>
              </div>
            )}
          />
        </Card>
      )}

      {/* Top Contributors Card */}
      <Card
        className={cardStyles}
        styles={cardStylesProp}
        title={<span className="font-medium text-[var(--ant-color-text)]">{t('top_contributors')}</span>}
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
                  {entry.contributionCount} · {entry.engagementScore}
                </div>
              </div>
            </div>
          )}
        />
      </Card>

      {/* Collections Card */}
      <Card
        className={cardStyles}
        styles={cardStylesProp}
        title={
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="font-medium text-[var(--ant-color-text)]">{t('collections')}</span>
            <Tooltip title={t('collection_create')}>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label={t('collection_create')}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftName('');
                  setCreateOpen(true);
                }}
              />
            </Tooltip>
          </div>
        }
      >
        <List
          dataSource={data.collections ?? []}
          locale={{ emptyText: <div className="p-4 text-[var(--ant-color-text-description)]">{t('no_collections')}</div> }}
          renderItem={(collection) => {
            const isUserCollection = !SYNTHETIC_COLLECTION_IDS.has(collection.id);
            return (
              <div className="flex items-center gap-2 p-3 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors group">
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => openCollection(collection.id)}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                    style={{ backgroundColor: `${collection.color}15`, color: collection.color }}
                  >
                    <FolderOpenOutlined />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--ant-color-text)] group-hover:text-[var(--ant-color-primary)] transition-colors truncate">
                      {collection.name}
                    </div>
                    <div className="text-xs text-[var(--ant-color-text-secondary)] mt-0.5">
                      {t('collections_n_items', { count: collection.count })}
                    </div>
                  </div>
                </div>
                {isUserCollection ? (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'rename',
                          icon: <EditOutlined />,
                          label: t('collection_rename'),
                          onClick: () => {
                            setActiveCollection({ id: collection.id, name: collection.name });
                            setDraftName(collection.name);
                            setRenameOpen(true);
                          },
                        },
                        {
                          key: 'delete',
                          icon: <DeleteOutlined />,
                          label: t('collection_delete'),
                          danger: true,
                          onClick: () => handleDeleteCollection({ id: collection.id, name: collection.name }),
                        },
                      ],
                    }}
                  >
                    <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('collection_manage')} />
                  </Dropdown>
                ) : null}
              </div>
            );
          }}
        />
      </Card>

      {/* Trending Tags Card */}
      <Card
        className={cardStyles}
        styles={{ header: cardHeadStyles }}
        title={<span className="font-medium text-[var(--ant-color-text)]">{t('trending_tags')}</span>}
      >
        <div className="flex flex-wrap gap-2">
          {(data.trendingTags ?? []).map((tag) => (
            <div
              key={tag.tag}
              role="button"
              tabIndex={0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--ant-color-bg-layout)] hover:bg-[var(--ant-color-border-secondary)] border border-[var(--ant-color-border)] rounded-full cursor-pointer transition-colors text-sm"
              onClick={() => onTagClick?.(tag.tag)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTagClick?.(tag.tag);
                }
              }}
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
        styles={cardStylesProp}
        title={<span className="font-medium text-[var(--ant-color-text)]">{t('latest_activity')}</span>}
      >
        <List
          dataSource={(data.activity ?? []).slice(0, 6)}
          renderItem={(activity) => (
            <div
              className="p-4 border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors flex gap-3 items-start cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => activity.postId && onOpenItem(activity.postId)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && activity.postId) {
                  e.preventDefault();
                  onOpenItem(activity.postId);
                }
              }}
            >
              <Avatar
                size={28}
                src={activity.actor.avatarUrl}
                className="bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)] shrink-0 mt-0.5"
              >
                {activity.actor.name.charAt(0)}
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--ant-color-text-secondary)] leading-snug line-clamp-2 m-0">
                  <span className="font-medium text-[var(--ant-color-text)]">{activity.actor.name}</span>{' '}
                  {formatActivityAction(activity.action)}
                  <span className="text-[var(--ant-color-text)]"> · {activity.title}</span>
                </p>
                <div className="flex items-center gap-1 mt-1 text-[11px] text-[var(--ant-color-text-description)]">
                  <ClockCircleOutlined />
                  <span>{activity.time}</span>
                </div>
              </div>
            </div>
          )}
        />
      </Card>

      <Modal
        title={t('collection_create')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={t('collection_name_placeholder')}
          maxLength={80}
          onPressEnter={() => void handleCreate()}
        />
      </Modal>

      <Modal
        title={t('collection_rename')}
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false);
          setActiveCollection(null);
        }}
        onOk={() => void handleRename()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={t('collection_name_placeholder')}
          maxLength={80}
          onPressEnter={() => void handleRename()}
        />
      </Modal>
    </div>
  );
};

export default FeedSidebar;
