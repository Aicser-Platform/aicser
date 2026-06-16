'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, message } from 'antd';
import { ArrowLeftOutlined, StarOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import FeedCard from '../components/FeedCard';
import FeedCardSkeleton from '../components/FeedCardSkeleton';
import { socialFeedService } from '@/services/socialFeedService';
import type { FeedItem } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useFeedInteractions } from '@/hooks/feed/useFeedInteractions';
import { errorMessage } from '@/hooks/feed/feedInteractionUtils';

const SAVED_FETCH_PAGE_SIZE = 100;
const SAVED_FETCH_MAX_ITEMS = 200;
const SAVED_SKELETON_COUNT = 4;

const SavedFeedPage: React.FC = () => {
  const t = useTranslations('feed_page');
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const itemsRef = useRef<FeedItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleToggleFollow,
    handleDeleteItem,
    handleCommentDeleted,
  } = useFeedInteractions(items, setItems);

  const loadSavedItems = useCallback(async () => {
    setLoading(true);
    try {
      const collected: FeedItem[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (offset < total && collected.length < SAVED_FETCH_MAX_ITEMS) {
        const limit = Math.min(SAVED_FETCH_PAGE_SIZE, SAVED_FETCH_MAX_ITEMS - collected.length);
        const response = await socialFeedService.getSavedFeed({ sort: 'recent', limit, offset });
        const pageItems = response.items ?? [];
        collected.push(...pageItems);
        total = response.total;
        offset += pageItems.length;
        if (pageItems.length === 0) break;
      }

      setItems(collected);
      itemsRef.current = collected;
    } catch (error) {
      message.error(errorMessage(error, t('failed_load_saved')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadSavedItems();
  }, [loadSavedItems]);

  return (
    <DashboardPageShell maxWidth={900}>
      <DashboardPageHeader
        icon={<StarOutlined />}
        title={t('saved_items_title')}
        description={t('saved_page_desc')}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/feed')}>
            {t('back_to_feed')}
          </Button>
        }
      />

      <div className="page-body">
        <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
          {loading && (
            <div className="flex flex-col gap-6">
              {Array.from({ length: SAVED_SKELETON_COUNT }).map((_, index) => (
                <FeedCardSkeleton key={`saved-skeleton-${index}`} compact />
              ))}
            </div>
          )}

          {!loading && items.length === 0 && (
            <Empty
              description={t('saved_empty')}
              className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
            />
          )}

          {!loading && items.length > 0 && (
            <div className="flex flex-col gap-6">
              {items.map((item) => (
                <FeedCard
                  key={item.id}
                  item={item}
                  onReact={handleReact}
                  onSave={handleSave}
                  onAddComment={handleAddComment}
                  onToggleFollow={handleToggleFollow}
                  onDeleteItem={handleDeleteItem}
                  onCommentDeleted={handleCommentDeleted}
                  interactionState={pendingInteractions[item.id]}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardPageShell>
  );
};

export default SavedFeedPage;
