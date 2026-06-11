'use client';
export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { Button, Empty } from 'antd';
import { ArrowLeftOutlined, CompassOutlined, EditOutlined, MessageOutlined } from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import type { FeedItem } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import FeedDetailSkeleton from '../components/FeedDetailSkeleton';
import FeedCard from '../components/FeedCard';
import { FeedPostViewer } from '../components/FeedPostViewer';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { canOpenFeedAsset, getFeedAskAiPath, getFeedAssetPath } from '@/utils/feedAssetLinks';

const FeedDetailPage: React.FC = () => {
  const t = useTranslations('feed');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const itemId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { user } = useAuth();

  const [item, setItem] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleToggleFollow,
    handleDeleteItem,
    handleCommentDeleted,
  } = useFeedItemInteractions(item, setItem);

  useEffect(() => {
    let active = true;
    setLoading(true);

    socialFeedService
      .getItemById(itemId)
      .then((result) => {
        if (!active) return;
        setItem(result);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [itemId]);

  useEffect(() => {
    if (!itemId) return;
    let active = true;

    socialFeedService
      .trackView(itemId)
      .then((response) => {
        if (!active) return;
        setItem((prev) =>
          prev
            ? {
                ...prev,
                metrics: { ...prev.metrics, views: response.view_count },
              }
            : prev
        );
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [itemId]);

  if (loading) {
    return (
      <DashboardPageShell maxWidth={900}>
        <FeedDetailSkeleton />
      </DashboardPageShell>
    );
  }

  if (!item) {
    return (
      <DashboardPageShell maxWidth={900}>
        <DashboardPageHeader
          title={t('detail_not_found')}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/feed')}>
              {t('back_to_feed')}
            </Button>
          }
        />
        <Empty
          description={t('detail_not_found')}
          className="my-12 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] py-16"
        />
      </DashboardPageShell>
    );
  }

  const isPostOwner = !!user && item.author?.id === user.id;
  const canOpenAsset = canOpenFeedAsset(item, isPostOwner);
  const isDashboard = item.assetType === 'dashboard';

  return (
    <DashboardPageShell maxWidth={900}>
      <main className="flex w-full min-w-0 flex-col gap-6">
        <DashboardPageHeader
          icon={<CompassOutlined />}
          title={item.title}
          extra={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/feed')}>
                {t('back_to_feed')}
              </Button>
              <Button icon={<MessageOutlined />} onClick={() => router.push(getFeedAskAiPath(item))}>
                {t('ask_ai_about_this')}
              </Button>
              {canOpenAsset && (
                <Button
                  type="primary"
                  icon={isPostOwner && isDashboard ? <EditOutlined /> : undefined}
                  onClick={() => router.push(getFeedAssetPath(item))}
                >
                  {isPostOwner && isDashboard ? t('edit_dashboard') : t('open_in_studio')}
                </Button>
              )}
            </div>
          }
        />

        {(isDashboard || item.renderMode === 'snapshot') && (
          <section className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
            <div className="flex flex-col gap-1 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5">
              <span className="text-sm font-semibold text-[var(--ant-color-text)]">
                {item.renderMode === 'snapshot' ? t('snapshot_preview_heading') : t('live_dashboard_preview')}
              </span>
              {item.snapshot?.capturedAt ? (
                <span className="text-xs text-[var(--ant-color-text-tertiary)]">
                  {t('snapshot_from_date', {
                    date: new Date(item.snapshot.capturedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }),
                  })}
                </span>
              ) : null}
            </div>
            <div className="min-h-[200px] bg-[var(--ant-color-bg-layout)] p-4 sm:p-5 md:p-6">
              <FeedPostViewer item={item} variant="detail" />
            </div>
          </section>
        )}

        <section aria-label={item.title}>
          <FeedCard
            item={item}
            onReact={handleReact}
            onSave={handleSave}
            onAddComment={handleAddComment}
            onToggleFollow={handleToggleFollow}
            onDeleteItem={handleDeleteItem}
            onCommentDeleted={handleCommentDeleted}
            interactionState={pendingInteractions[item.id]}
            compact={false}
          />
        </section>
      </main>
    </DashboardPageShell>
  );
};

export default FeedDetailPage;
