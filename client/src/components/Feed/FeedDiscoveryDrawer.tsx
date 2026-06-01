'use client';

import React from 'react';
import { Drawer } from 'antd';
import { CompassOutlined } from '@ant-design/icons';
import FeedSidebar from '@/app/(dashboard)/feed/components/FeedSidebar';
import type { AssetType, FeedSidebarData, LeaderboardSortBy, LeaderboardTimeRange } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';

interface FeedDiscoveryDrawerProps {
  open: boolean;
  onClose: () => void;
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
}

const FeedDiscoveryDrawer: React.FC<FeedDiscoveryDrawerProps> = ({
  open,
  onClose,
  data,
  loading,
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
}) => {
  const t = useTranslations('feed_page');

  return (
    <Drawer
      title={
        <span className="flex items-center gap-2">
          <CompassOutlined />
          {t('discover_sidebar')}
        </span>
      }
      placement="bottom"
      height="85vh"
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      <FeedSidebar
        data={data}
        loading={loading}
        timeRange={timeRange}
        contentType={contentType}
        sortBy={sortBy}
        onChangeTimeRange={onChangeTimeRange}
        onChangeContentType={onChangeContentType}
        onChangeSortBy={onChangeSortBy}
        onOpenItem={(postId) => {
          onOpenItem(postId);
          onClose();
        }}
        onLikeItem={onLikeItem}
        onSaveItem={onSaveItem}
        onTagClick={onTagClick}
        showRecommended
      />
    </Drawer>
  );
};

export default FeedDiscoveryDrawer;
