'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
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
import FeedCardActions from '../components/FeedCard/FeedCardActions';
import FeedDiscussion from '../components/FeedDiscussion/FeedDiscussion';
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

  const { pendingInteractions, handleReact, handleSave, handleAddComment, handleCommentDeleted } =
    useFeedItemInteractions(item, setItem);

  // No-op stand-ins for FeedCardActions props that have no equivalent on the
  // detail page (there's no comment-box-toggle concept anymore, and "open"
  // would just navigate to this same page).
  const noop = useCallback(() => {}, []);
  const stopPropagation = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

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

  const detailPath = `/feed/${item.id}`;
  const reacting = Boolean(pendingInteractions[item.id]?.reacting);
  const saving = Boolean(pendingInteractions[item.id]?.saving);
  const commenting = Boolean(pendingInteractions[item.id]?.commenting);

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
                <Tag color="green" className="m-0 rounded-full px-3 py-1">{visibilityLabel}</Tag>
                {/* {item.renderMode === 'snapshot' ? (
                  <Tag color="purple" className="m-0 rounded-full px-3 py-1">
                    {t('snapshot_badge')}
                  </Tag>
                ) : null} */}
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

          {/* Applause / Save / Share actions, lifted up from the old embedded FeedCard footer.
              "Open" is omitted in compact mode here since this already is the detail page —
              navigating to itself would be a no-op surprise for the user. */}
          <div className="-mx-1 mt-1 pt-1">
            <FeedCardActions
              item={item}
              compact
              reacting={reacting}
              saving={saving}
              commenting={commenting}
              detailPath={detailPath}
              stopPropagation={stopPropagation}
              onReact={handleReact}
              onSave={handleSave}
              onOpen={noop}
              onPrefetch={noop}
              showCommentBox={false}
              onToggleCommentBox={noop}
              closeCommentReactionPicker={noop}
            />
          </div>
        </section>

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)]">
              <div className="flex min-w-0 flex-col gap-1 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[var(--ant-color-primary)]">{assetIcon}</span>
                  <span className="truncate text-sm font-medium text-[var(--ant-color-text)]">{previewHeading}</span>
                </div>
                {snapshotDate ? (
                  <span className="shrink-0 text-xs font-normal text-[var(--ant-color-text-tertiary)]">
                    {t('snapshot_from_date', { date: snapshotDate })}
                  </span>
                ) : null}
              </div>
              <div className="min-h-[340px] bg-[var(--ant-color-bg-layout)] p-4 sm:p-5">
                {useFullViewer ? (
                  <FeedPostViewer item={item} variant="detail" />
                ) : (
                  <div className="min-h-[300px] overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] shadow-sm">
                    <FeedPreviewVisual item={item} />
                  </div>
                )}
              </div>
            </div>

            <FeedDiscussion
              item={item}
              onAddComment={handleAddComment}
              onCommentDeleted={handleCommentDeleted}
              commenting={commenting}
            />
          </div>

          <FeedDetailSidebar item={item} visibilityLabel={visibilityLabel} />
        </div>
      </main>
    </DashboardPageShell>
  );
};

export default FeedDetailPage;
