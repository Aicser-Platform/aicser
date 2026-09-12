'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FeedCardActions from '@/app/(dashboard)/feed/components/FeedCard/FeedCardActions';
import FeedDiscussion from '@/app/(dashboard)/feed/components/FeedDiscussion/FeedDiscussion';
import { FeedPostViewer } from '@/app/(dashboard)/feed/components/FeedPostViewer';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { DiscoverDetailActions } from '@/components/discover/DiscoverDetailActions';
import { socialFeedService, type FeedItem } from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { useDiscoverReferral, getStoredDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';

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
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        className="mb-4"
        onClick={() => router.push('/discover')}
      >
        {t('back_to_discover')}
      </Button>
      <DiscoverDetailActions item={item} className="mb-4" />

      <div className="discover-detail-preview">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--ant-color-border-secondary)]">
          <FeedPostContent item={item} variant="detail" />
        </div>
        <div className="discover-detail-preview-inner">
          <FeedPostViewer item={item} variant="detail" />
        </div>
      </div>

      {isAuthenticated ? (
        <div className="mt-4 flex flex-col gap-4">
          <FeedCardActions
            item={item}
            reacting={reacting}
            saving={saving}
            commenting={commenting}
            detailPath={`/discover/${item.id}`}
            stopPropagation={stopPropagation}
            onReact={handleReact}
            onSave={handleSave}
            onOpen={noop}
            onPrefetch={noop}
            showCommentBox={false}
            hideOpen
            hideMetricsSummary
            onToggleCommentBox={() => {
              document.getElementById('discover-detail-discussion')?.scrollIntoView({ behavior: 'smooth' });
            }}
            closeCommentReactionPicker={noop}
          />
          <div id="discover-detail-discussion">
            <FeedDiscussion
              item={item}
              onAddComment={handleAddComment}
              onCommentDeleted={handleCommentDeleted}
              commenting={commenting}
            />
          </div>
        </div>
      ) : (
        <div className="discover-signin-cta my-6">
          <p>{t('interact_cta')}</p>
          <Link href={`/login?next=${encodeURIComponent(`/discover/${itemId}`)}`}>
            <Button type="primary">{t('sign_in')}</Button>
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
