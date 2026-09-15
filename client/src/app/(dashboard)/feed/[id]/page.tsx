'use client';

import './feed-detail.css';
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Dropdown, Empty, Modal, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  CompressOutlined,
  EditOutlined,
  ExpandOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import type { FeedItem } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import FeedDetailSkeleton from '../components/FeedDetailSkeleton';
import FeedCardActions from '../components/FeedCard/FeedCardActions';
import FeedPostEditBox from '../components/FeedCard/FeedPostEditBox';
import FeedDiscussion from '../components/FeedDiscussion/FeedDiscussion';
import FeedDetailByline from '../components/FeedDetailSidebar';
import { FeedPostViewer } from '../components/FeedPostViewer';
import FeedPreviewVisual from '../components/FeedPreviewVisual';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useMentionableMembers, resolveMentionedUserIds } from '@/hooks/feed/useMentionableMembers';
import { useTranslations } from 'next-intl';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { canOpenFeedAsset, getFeedAskAiPath, getFeedAssetPath } from '@/utils/feedAssetLinks';
import { feedItemDisplayTitle } from '@/utils/sanitizeDisplayTitle';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { resolveFeedPostSummary } from '@/components/Feed/feedPostDisplay';

const { Title } = Typography;

const FeedDetailPage: React.FC = () => {
  const t = useTranslations('feed');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const itemId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { user } = useAuth();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [item, setItem] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostValue, setEditPostValue] = useState('');

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleCommentDeleted,
    handleDeleteItem,
    handleUpdatePost,
  } = useFeedItemInteractions(item, setItem);

  const currentProject = useProjectStore((s) => s.currentProject);
  const organizationId =
    currentProject?.organization_id || (currentProject as { organizationId?: string } | null)?.organizationId;
  const { members: mentionMembers, options: editMentionOptions } = useMentionableMembers(
    'organization',
    organizationId,
    user?.id,
  );

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
            : prev,
        );
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [itemId]);

  // A plain CSS/state "fullscreen" (fixed overlay) instead of the native
  // Fullscreen API: the browser-native mode promotes the element into the
  // top layer, and mouse-wheel scrolling on the inner overflow:auto canvas
  // was unreliable there across browsers. Staying in normal document flow
  // keeps scrolling behavior identical to the non-fullscreen view.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

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
  const handleStartEditPost = () => {
    setEditPostValue(resolveFeedPostSummary(item) || item.description || '');
    setIsEditingPost(true);
  };
  const handleCancelEditPost = () => setIsEditingPost(false);
  const handleSaveEditPost = async () => {
    const body = editPostValue.trim();
    if (!body) return;
    const mentionedUsers = resolveMentionedUserIds(body, mentionMembers);
    const success = await handleUpdatePost(item.id, body, mentionedUsers);
    if (success) setIsEditingPost(false);
  };
  const handleDeletePost = () => {
    Modal.confirm({
      title: t('delete_post_confirm_title'),
      content: t('delete_post_confirm_content'),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: async () => {
        await handleDeleteItem(item.id);
        router.push('/feed');
      },
    });
  };
  const moreMenuItems: MenuProps['items'] = [
    { key: 'ask-ai', label: t('ask_ai_about_this') },
    ...(canOpenAsset && !(isPostOwner && isDashboard)
      ? [{ key: 'open-studio', label: t('open_in_studio') }]
      : []),
    ...(item.canEdit ? [{ key: 'edit', label: t('edit_post') }] : []),
    ...(isPostOwner ? [{ key: 'delete', danger: true, label: t('delete_post') }] : []),
  ];
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
  const snapshotDate = item.snapshot?.capturedAt
    ? new Date(item.snapshot.capturedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  const useFullViewer = isDashboard || item.renderMode === 'snapshot';
  const displayTitle = feedItemDisplayTitle(
    item,
    isDashboard ? t('badge_type_dashboard') : t('badge_type_chart'),
  );

  const detailPath = `/feed/${item.id}`;
  const reacting = Boolean(pendingInteractions[item.id]?.reacting);
  const saving = Boolean(pendingInteractions[item.id]?.saving);
  const commenting = Boolean(pendingInteractions[item.id]?.commenting);

  return (
    <DashboardPageShell>
      <main className="feed-detail-page flex w-full min-w-0 flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/feed')}
            aria-label={t('back_to_feed')}
          >
            {t('back_to_feed')}
          </Button>
          <div className="flex items-center gap-2">
            {canOpenAsset && isPostOwner && isDashboard ? (
              <Button
                type="primary"
                size="small"
                icon={<EditOutlined />}
                onClick={() => router.push(getFeedAssetPath(item))}
              >
                {t('edit_dashboard')}
              </Button>
            ) : null}
            <Dropdown
              trigger={['click']}
              menu={{
                items: moreMenuItems,
                onClick: ({ key }) => {
                  if (key === 'ask-ai') router.push(getFeedAskAiPath(item));
                  else if (key === 'open-studio') router.push(getFeedAssetPath(item));
                  else if (key === 'edit') handleStartEditPost();
                  else if (key === 'delete') handleDeletePost();
                },
              }}
            >
              <Button size="small" icon={<MoreOutlined />} aria-label={t('more_options')} />
            </Dropdown>
          </div>
        </div>

        <header className="min-w-0">
          <FeedDetailByline item={item} visibilityLabel={visibilityLabel} />
          {displayTitle ? (
            <Title level={2} className="!mb-0 !mt-3 !text-2xl sm:!text-3xl">
              {displayTitle}
            </Title>
          ) : null}
          {isEditingPost ? (
            <div className="mt-3">
              <FeedPostEditBox
                compact={false}
                value={editPostValue}
                onChange={setEditPostValue}
                mentionOptions={editMentionOptions}
                saving={Boolean(pendingInteractions[item.id]?.updatingPost)}
                onSave={handleSaveEditPost}
                onCancel={handleCancelEditPost}
              />
            </div>
          ) : (
            <div className="mt-3">
              <FeedPostContent item={item} variant="detail" showTitle={false} />
            </div>
          )}
        </header>

        {item.assetType !== 'post' && (
          <div
            className={`feed-detail-viz rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]${
              isFullscreen ? ' feed-detail-viz--fullscreen' : ''
            }`}
          >
            <div className="flex min-w-0 items-center justify-end gap-3 px-2 py-1 sm:px-3">
              {snapshotDate ? (
                <span className="mr-auto truncate text-xs text-[var(--ant-color-text-quaternary)]">
                  {t('snapshot_from_date', { date: snapshotDate })}
                </span>
              ) : null}
              <Button
                type="text"
                size="small"
                icon={isFullscreen ? <CompressOutlined /> : <ExpandOutlined />}
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? t('exit_full_screen') : t('full_screen')}
              />
            </div>
            <div className="feed-detail-viz-canvas bg-[var(--ant-color-bg-container)]">
              {useFullViewer ? (
                <FeedPostViewer item={item} variant="detail" />
              ) : (
                <div className="min-h-[360px] overflow-hidden bg-[var(--ant-color-bg-container)]">
                  <FeedPreviewVisual item={item} />
                </div>
              )}
            </div>
          </div>
        )}

        <FeedCardActions
          item={item}
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
          hideOpen
          hideMetricsSummary
          onToggleCommentBox={() => {
            document.getElementById('feed-detail-discussion')?.scrollIntoView({ behavior: 'smooth' });
          }}
          closeCommentReactionPicker={noop}
        />

        <div id="feed-detail-discussion">
          <FeedDiscussion
            item={item}
            onAddComment={handleAddComment}
            onCommentDeleted={handleCommentDeleted}
            commenting={commenting}
          />
        </div>
      </main>
    </DashboardPageShell>
  );
};

export default FeedDetailPage;
