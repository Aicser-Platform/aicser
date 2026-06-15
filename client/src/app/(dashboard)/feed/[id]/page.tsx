'use client';
export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { Breadcrumb, Button, Card, Empty, Tag, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BulbOutlined,
  DashboardOutlined,
  EditOutlined,
  MessageOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import type { FeedItem } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import FeedDetailSkeleton from '../components/FeedDetailSkeleton';
import FeedCard from '../components/FeedCard';
import FeedDetailSidebar from '../components/FeedDetailSidebar';
import { FeedPostViewer } from '../components/FeedPostViewer';
import FeedPreviewVisual from '../components/FeedPreviewVisual';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { canOpenFeedAsset, getFeedAskAiPath, getFeedAssetPath } from '@/utils/feedAssetLinks';
import { assetTypeLabelKey } from '@/components/Feed/feedPostDisplay';

const { Paragraph, Title } = Typography;

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
    if (!itemId) {
      setLoading(false);
      setItem(null);
      return;
    }

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
      <DashboardPageShell>
        <FeedDetailSkeleton />
      </DashboardPageShell>
    );
  }

  if (!item) {
    return (
      <DashboardPageShell maxWidth={960}>
        <Card className="border-[var(--ant-color-border-secondary)] shadow-none">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('detail_not_found')}>
            <Button type="primary" icon={<ArrowLeftOutlined />} onClick={() => router.push('/feed')}>
              {t('back_to_feed')}
            </Button>
          </Empty>
        </Card>
      </DashboardPageShell>
    );
  }

  const isPostOwner = !!user && item.author?.id === user.id;
  const canOpenAsset = canOpenFeedAsset(item, isPostOwner);
  const isDashboard = item.assetType === 'dashboard';
  const assetTypeLabel = t(assetTypeLabelKey(item.assetType) as 'insights_type');
  const visibilityLabel = (() => {
    switch (item.visibility) {
      case 'organization':
        return t('scope_organization');
      case 'project':
        return t('scope_project');
      case 'private':
        return t('scope_private');
      case 'following':
        return t('scope_following');
      case 'public':
        return t('scope_public');
    }
  })();
  const assetIcon = (() => {
    switch (item.assetType) {
      case 'dashboard':
        return <DashboardOutlined />;
      case 'chart':
        return <BarChartOutlined />;
      case 'query':
        return <SearchOutlined />;
      case 'insight':
        return <BulbOutlined />;
    }
  })();
  const snapshotDate = item.snapshot?.capturedAt
    ? new Date(item.snapshot.capturedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  const useFullViewer = isDashboard || item.renderMode === 'snapshot';
  const previewHeading =
    item.renderMode === 'snapshot'
      ? t('snapshot_preview_heading')
      : isDashboard
        ? t('live_dashboard_preview')
        : t('data_snapshot');

  return (
    <DashboardPageShell>
      <main className="flex w-full min-w-0 flex-col gap-5">
        <Breadcrumb
          items={[
            {
              title: (
                <button
                  type="button"
                  className="transition-colors hover:text-[var(--ant-color-primary)]"
                  onClick={() => router.push('/feed')}
                >
                  {t('breadcrumb_feed')}
                </button>
              ),
            },
            { title: assetTypeLabel },
          ]}
        />

        <section className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Tag icon={assetIcon} color="blue" className="m-0 rounded-full px-3 py-1">
                  {assetTypeLabel}
                </Tag>
                <Tag className="m-0 rounded-full px-3 py-1">{visibilityLabel}</Tag>
                {item.renderMode === 'snapshot' ? (
                  <Tag color="purple" className="m-0 rounded-full px-3 py-1">
                    {t('snapshot_badge')}
                  </Tag>
                ) : null}
              </div>
              <Title level={2} className="!mb-2 !mt-0 !text-2xl sm:!text-3xl">
                {item.title}
              </Title>
              {item.description ? (
                <Paragraph type="secondary" className="!mb-0 max-w-3xl !text-sm !leading-6 sm:!text-base">
                  {item.description}
                </Paragraph>
              ) : null}
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:max-w-md lg:justify-end">
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
          </div>
        </section>

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Card
              className="overflow-hidden border-[var(--ant-color-border-secondary)] shadow-none"
              styles={{ body: { padding: 0 } }}
              title={
                <div className="flex min-w-0 flex-col gap-1 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[var(--ant-color-primary)]">{assetIcon}</span>
                    <span className="truncate">{previewHeading}</span>
                  </div>
                  {snapshotDate ? (
                    <span className="shrink-0 text-xs font-normal text-[var(--ant-color-text-tertiary)]">
                      {t('snapshot_from_date', { date: snapshotDate })}
                    </span>
                  ) : null}
                </div>
              }
            >
              <div className="min-h-[300px] bg-[var(--ant-color-bg-layout)] p-3 sm:p-4">
                {useFullViewer ? (
                  <FeedPostViewer item={item} variant="detail" />
                ) : (
                  <div className="min-h-[300px] overflow-hidden rounded-lg bg-[var(--ant-color-bg-container)]">
                    <FeedPreviewVisual item={item} />
                  </div>
                )}
              </div>
            </Card>

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
                hidePreview
              />
            </section>
          </div>

          <FeedDetailSidebar item={item} visibilityLabel={visibilityLabel} />
        </div>
      </main>
    </DashboardPageShell>
  );
};

export default FeedDetailPage;
