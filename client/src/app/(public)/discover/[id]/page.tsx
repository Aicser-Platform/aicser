'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useEffect, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FeedCard from '@/app/(dashboard)/feed/components/FeedCard';
import { FeedPostViewer } from '@/app/(dashboard)/feed/components/FeedPostViewer';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { DiscoverDetailActions } from '@/components/discover/DiscoverDetailActions';
import { socialFeedService, type FeedItem } from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useFeedItemInteractions } from '@/hooks/feed/useFeedInteractions';
import { useDiscoverReferral, getStoredDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';
import '@/app/(dashboard)/feed/styles.css';

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
    handleToggleFollow,
  } = useFeedItemInteractions(item, setItem);

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

  if (isAuthenticated) {
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
        <FeedCard
          item={item}
          detailBasePath="/discover"
          onReact={handleReact}
          onSave={handleSave}
          onAddComment={handleAddComment}
          onToggleFollow={handleToggleFollow}
          interactionState={pendingInteractions[item.id]}
          compact={false}
        />
      </>
    );
  }

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
        <div className="px-5 pt-4 pb-2 border-b border-[var(--ant-color-border-secondary)]">
          <FeedPostContent item={item} />
        </div>
        <div className="discover-detail-preview-inner">
          <FeedPostViewer item={item} variant="detail" />
        </div>
      </div>

      <div className="discover-signin-cta my-6">
        <p>{t('interact_cta')}</p>
        <Link href={`/login?next=${encodeURIComponent(`/discover/${itemId}`)}`}>
          <Button type="primary">{t('sign_in')}</Button>
        </Link>
      </div>
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
