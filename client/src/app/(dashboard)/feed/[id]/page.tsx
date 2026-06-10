'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
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
import '../styles.css';

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
    return <FeedDetailSkeleton />;
  }

  if (!item) {
    return (
      <DashboardPageShell maxWidth={1400}>
        <DashboardPageHeader
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/feed')}>
              {t('back_to_feed')}
            </Button>
          }
        />
        <Empty
          description={t('detail_not_found')}
          className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
        />
      </DashboardPageShell>
    );
  }

  const isPostOwner = !!user && item.author?.id === user.id;
  const canOpenAsset = canOpenFeedAsset(item, isPostOwner);
  const isDashboard = item.assetType === 'dashboard';

  return (
    <DashboardPageShell maxWidth={900}>
      <div className="page-body">
        <DashboardPageHeader
          icon={<CompassOutlined />}
          title={item.title}
          extra={
            <div className="flex flex-wrap items-center gap-2">
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
          <div className="mb-6 bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)] flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--ant-color-text)]">
                {item.renderMode === 'snapshot' ? t('snapshot_preview_heading') : t('live_dashboard_preview')}
              </span>
              {item.snapshot?.capturedAt ? (
                <span className="text-xs text-[var(--ant-color-text-description)]">
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
            <div className="p-4 md:p-6 bg-[var(--ant-color-bg-layout)]/30 min-h-[200px]">
              <FeedPostViewer item={item} variant="detail" />
            </div>
          </div>
        )}

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
      </div>
    </DashboardPageShell>
  );
};

export default FeedDetailPage;
