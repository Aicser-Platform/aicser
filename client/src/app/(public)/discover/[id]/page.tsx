'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Empty, Spin, Tag, Tooltip, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FeedCardActions from '@/app/(dashboard)/feed/components/FeedCard/FeedCardActions';
import FeedDiscussion from '@/app/(dashboard)/feed/components/FeedDiscussion/FeedDiscussion';
import { FeedPostViewer } from '@/app/(dashboard)/feed/components/FeedPostViewer';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';
import { assetTypeLabelKey, showFeedAssetTypeBadge, isFeedPostAuthor } from '@/components/Feed/feedPostDisplay';
import { DiscoverDetailActions } from '@/components/discover/DiscoverDetailActions';
import { socialFeedService, formatTimeAgo, type FeedItem, type ReactionType } from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { useDiscoverReferral, getStoredDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';

function DiscoverDetailAuthorRow({ item }: { item: FeedItem }) {
  const t = useTranslations('discover');
  const tf = useTranslations('feed');
  const { user } = useAuthStore();
  const isAuthor = isFeedPostAuthor(item, user);
  const { avatarUrl, name } = useFeedAuthorDisplay(item.author);
  const showTypeBadge = showFeedAssetTypeBadge(item.assetType);
  const assetTypeLabel = showTypeBadge ? tf(assetTypeLabelKey(item.assetType) as 'insights_type') : null;
  const username = item.author.username ? item.author.username.replace(/^@/, '') : '';
  const authorHref = username ? `/discover/author/${encodeURIComponent(username)}` : null;

  return (
    <div className="discover-detail-author-row">
      <div className="discover-detail-author-info">
        {authorHref ? (
          <Link href={authorHref}>
            <Avatar size={42} src={avatarUrl} className="cursor-pointer hover:opacity-90 transition-opacity">
              {name.charAt(0).toUpperCase()}
            </Avatar>
          </Link>
        ) : (
          <Avatar size={42} src={avatarUrl}>
            {name.charAt(0).toUpperCase()}
          </Avatar>
        )}
        <div className="discover-detail-author-names">
          <div className="flex items-center gap-1.5">
            {authorHref ? (
              <Link href={authorHref} className="discover-detail-author-name">
                {name}
              </Link>
            ) : (
              <span className="discover-detail-author-name">{name}</span>
            )}
            {isAuthor ? (
              <span className="shrink-0 rounded-full bg-[var(--ant-color-primary-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-primary)]">
                Author
              </span>
            ) : null}
          </div>
          <span className="discover-detail-author-meta">
            {username ? <span>@{username}</span> : null}
            {username ? <span>·</span> : null}
            <span>{t('published_on', { time: formatTimeAgo(item.publishedAt) })}</span>
          </span>
        </div>
      </div>
      {assetTypeLabel ? (
        <Tag color="cyan" className="m-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
          {assetTypeLabel}
        </Tag>
      ) : null}
    </div>
  );
}

function DiscoverDetailContent() {
  const t = useTranslations('discover');
  const tf = useTranslations('feed');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const itemId = typeof params?.id === 'string' ? params.id : '';
  const { isAuthenticated } = useAuthStore();
  const referral = useDiscoverReferral();

  const [item, setItem] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleCommentDeleted,
  } = useFeedItemInteractions(item, setItem);

  const handleAuthReact = useCallback(
    (targetId: string, reaction: ReactionType) => {
      if (!isAuthenticated) {
        message.info(t('interact_cta'));
        return;
      }
      return handleReact(targetId, reaction);
    },
    [isAuthenticated, handleReact, t]
  );

  const handleAuthSave = useCallback(
    (targetId: string) => {
      if (!isAuthenticated) {
        message.info(t('interact_cta'));
        return;
      }
      return handleSave(targetId);
    },
    [isAuthenticated, handleSave, t]
  );

  const noop = useCallback(() => {}, []);
  const stopPropagation = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!itemId) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      setLoading(true);
      const loaded = isAuthenticated
        ? (await socialFeedService.getItemById(itemId)) ||
          (await socialFeedService.getPublicItemById(itemId))
        : await socialFeedService.getPublicItemById(itemId);
      if (!active) return;
      setItem(loaded);
      setLoading(false);
      if (loaded) void socialFeedService.trackPublicView(itemId, getStoredDiscoverReferral() || referral);
    })();
    return () => {
      active = false;
    };
  }, [itemId, isAuthenticated, referral]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spin size="large" />
      </div>
    );
  }

  if (!item) {
    return (
      <Empty description={tf('detail_not_found')}>
        <Button onClick={() => router.push('/discover')}>{t('back_to_discover')}</Button>
      </Empty>
    );
  }

  const reacting = Boolean(pendingInteractions[item.id]?.reacting);
  const saving = Boolean(pendingInteractions[item.id]?.saving);
  const commenting = Boolean(pendingInteractions[item.id]?.commenting);

  return (
    <>
      <div className="discover-detail-topbar">
        <Tooltip title={t('back_to_discover')}>
          <Button
            type="default"
            shape="circle"
            icon={<ArrowLeftOutlined />}
            className="discover-detail-back-btn"
            aria-label={t('back_to_discover')}
            onClick={() => router.push('/discover')}
          />
        </Tooltip>
        <DiscoverDetailActions item={item} />
      </div>

      <div className="discover-detail-card">
        <DiscoverDetailAuthorRow item={item} />
        <div className="discover-detail-post-body">
          <FeedPostContent item={item} variant="detail" />
        </div>
        <div className="discover-detail-preview-inner">
          <FeedPostViewer item={item} variant="detail" />
        </div>
        <div className="border-t border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
          <FeedCardActions
            item={item}
            reacting={reacting}
            saving={saving}
            commenting={commenting}
            detailPath={`/discover/${item.id}`}
            stopPropagation={stopPropagation}
            onReact={handleAuthReact}
            onSave={handleAuthSave}
            onOpen={noop}
            onPrefetch={noop}
            showCommentBox={false}
            hideOpen
            onToggleCommentBox={() => {
              if (isAuthenticated) {
                document.getElementById('discover-detail-discussion')?.scrollIntoView({ behavior: 'smooth' });
              } else {
                document.getElementById('discover-detail-cta')?.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            closeCommentReactionPicker={noop}
          />
        </div>
      </div>

      {isAuthenticated ? (
        <div id="discover-detail-discussion" className="discover-discussion-card">
          <FeedDiscussion
            item={item}
            onAddComment={handleAddComment}
            onCommentDeleted={handleCommentDeleted}
            commenting={commenting}
          />
        </div>
      ) : (
        <div id="discover-detail-cta" className="discover-signin-cta my-6">
          <p className="text-base font-semibold mb-2">{t('interact_cta')}</p>
          <Link href={`/login?next=${encodeURIComponent(`/discover/${itemId}`)}`}>
            <Button type="primary" size="large">{t('sign_in')}</Button>
          </Link>
        </div>
      )}
    </>
  );
}

export default function DiscoverDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spin size="large" />
        </div>
      }
    >
      <DiscoverDetailContent />
    </Suspense>
  );
}
