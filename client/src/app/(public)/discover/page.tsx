'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, message } from 'antd';
import {
  TrophyOutlined,
  FireOutlined,
  MailOutlined,
  SearchOutlined,
  CompassOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import FeedGridCard from '@/app/(dashboard)/feed/components/FeedGridCard';
import FeedCardSkeleton from '@/app/(dashboard)/feed/components/FeedCardSkeleton';
import {
  socialFeedService,
  type FeedItem,
  type FeedLeaderboardItem,
  type AssetType,
  type ReactionType,
} from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';
import { useFeedInteractions } from '@/hooks/feed/useFeedInteractions';

const PAGE_SIZE = 10;

function DiscoverPageContent() {
  const t = useTranslations('discover');
  const searchParams = useSearchParams();
  useDiscoverReferral();
  const { isAuthenticated } = useAuthStore();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [trending, setTrending] = useState<FeedItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<FeedLeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [assetType, setAssetType] = useState<AssetType | 'all'>('all');
  const [digestEmail, setDigestEmail] = useState('');
  const [digestSubmitting, setDigestSubmitting] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleToggleFollow,
    handleDeleteItem,
  } = useFeedInteractions(items, setItems);

  const handleAuthReact = useCallback(
    (itemId: string, reaction: ReactionType) => {
      if (!isAuthenticated) {
        message.info(t('sign_in_cta'));
        return;
      }
      return handleReact(itemId, reaction);
    },
    [isAuthenticated, handleReact, t]
  );

  const handleAuthSave = useCallback(
    (itemId: string) => {
      if (!isAuthenticated) {
        message.info(t('sign_in_cta'));
        return;
      }
      return handleSave(itemId);
    },
    [isAuthenticated, handleSave, t]
  );

  const filterTabs = [
    { key: 'all', label: t('filter_all'), icon: <CompassOutlined /> },
    { key: 'dashboard', label: t('filter_dashboards'), icon: <AppstoreOutlined /> },
    { key: 'chart', label: t('filter_charts'), icon: <BarChartOutlined /> },
    { key: 'insight', label: t('filter_insights'), icon: <BulbOutlined /> },
  ];

  const loadPage = useCallback(
    async (offset: number, append: boolean, filterType = assetType) => {
      if (offset === 0) setLoading(true);
      else {
        if (loadingMore) return;
        setLoadingMore(true);
      }
      try {
        const res = await socialFeedService.getPublicFeed({
          sort: 'recommended',
          search: search.trim() || undefined,
          assetType: filterType !== 'all' ? filterType : undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setHasMore(offset + res.items.length < res.total);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search, assetType, loadingMore]
  );

  useEffect(() => {
    void loadPage(0, false, assetType);
  }, [loadPage, assetType]);

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(items.length, true);
        }
      },
      { rootMargin: '400px 0px', threshold: 0.01 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, items.length, loadPage]);

  useEffect(() => {
    void socialFeedService.getPublicTrendingFeed({ limit: 4, timeWindowDays: 7 }).then((res) => {
      setTrending(res.items);
    });
    void socialFeedService.getPublicLeaderboard(5).then((res) => {
      setLeaderboard(res.items);
    });
  }, []);

  useEffect(() => {
    const token = searchParams?.get('unsubscribe');
    if (!token) return;
    void socialFeedService
      .unsubscribeDigest(token)
      .then((res) => message.success(res.message || t('digest_unsubscribed')))
      .catch(() => message.error(t('digest_unsubscribe_failed')));
  }, [searchParams, t]);

  const handleAssetTypeChange = (nextType: AssetType | 'all') => {
    if (nextType === assetType) return;
    setAssetType(nextType);
  };

  const handleDigestSubscribe = async () => {
    const email = digestEmail.trim();
    if (!email) {
      message.warning(t('digest_email_required'));
      return;
    }
    setDigestSubmitting(true);
    try {
      const res = await socialFeedService.subscribeDigest(email);
      message.success(res.message || t('digest_subscribed'));
      setDigestEmail('');
    } catch {
      message.error(t('digest_subscribe_failed'));
    } finally {
      setDigestSubmitting(false);
    }
  };

  return (
    <div className="discover-layout-grid">
      <div className="discover-main-col">
        <section className="discover-hero">
          <span className="discover-hero-pill">
            <CompassOutlined /> {t('discover_badge')}
          </span>
          <h1 className="discover-hero-title">{t('hero_title')}</h1>
          <p className="discover-hero-desc">{t('hero_desc')}</p>
          {!isAuthenticated ? (
            <div className="discover-signin-cta">
              <p className="text-base font-semibold mb-2">{t('sign_in_cta')}</p>
              <Link href="/login?mode=signup">
                <Button type="primary" size="large">
                  {t('sign_up_free')}
                </Button>
              </Link>
            </div>
          ) : null}
        </section>

        <div className="discover-search-filter-bar mb-6">
          <Input
            size="large"
            prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
            placeholder={t('search_placeholder')}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onPressEnter={() => setSearch(searchDraft)}
            allowClear
            className="rounded-xl shadow-sm mb-3.5"
          />

          <div className="discover-filter-pills flex items-center gap-2 overflow-x-auto pb-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleAssetTypeChange(tab.key as AssetType | 'all')}
                className={`discover-filter-pill ${assetType === tab.key ? 'active' : ''}`}
              >
                <span className="text-xs">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="discover-feed-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <FeedCardSkeleton key={`sk-${i}`} compact />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty description={t('empty')} className="py-12" />
        ) : (
          <div>
            <div className="discover-feed-list">
              {items.map((item) => (
                <FeedGridCard
                  key={item.id}
                  item={item}
                  maxPreviews={3}
                  detailBasePath="/discover"
                  onReact={handleAuthReact}
                  onSave={handleAuthSave}
                  onToggleFollow={isAuthenticated ? handleToggleFollow : undefined}
                  onDeleteItem={isAuthenticated ? handleDeleteItem : undefined}
                  interactionState={pendingInteractions[item.id]}
                />
              ))}
            </div>
            {loadingMore && (
              <div className="mt-6 flex flex-col gap-6">
                <FeedCardSkeleton compact />
              </div>
            )}
            <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" />
            {!hasMore && items.length > 0 && (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--ant-color-text-tertiary)]">
                <span className="h-px flex-1 bg-[var(--ant-color-border-secondary)]" />
                <span className="px-4 font-medium">{t('all_caught_up')}</span>
                <span className="h-px flex-1 bg-[var(--ant-color-border-secondary)]" />
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="discover-sidebar-col">
        {trending.length > 0 && (
          <section className="discover-sidebar-section">
            <h2 className="discover-section-title">
              <FireOutlined style={{ color: '#f97316' }} /> {t('trending_title')}
            </h2>
            <div className="discover-trending-list">
              {trending.map((item) => (
                <Link key={item.id} href={`/discover/${item.id}`} className="discover-trending-card">
                  <span className="discover-trending-card-title">{item.title}</span>
                  <span className="discover-trending-card-meta">
                    {item.author.name} &bull; {item.metrics.views} {t('views_label')}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {leaderboard.length > 0 && (
          <section className="discover-sidebar-section">
            <h2 className="discover-section-title">
              <TrophyOutlined style={{ color: '#eab308' }} /> {t('leaderboard_title')}
            </h2>
            <ol className="discover-leaderboard-list">
              {leaderboard.map((entry) => (
                <li key={entry.id}>
                  <Link href={`/discover/${entry.postId}`} className="discover-leaderboard-row">
                    <span className={`discover-leaderboard-rank rank-${entry.rank}`}>
                      #{entry.rank}
                    </span>
                    <div className="discover-leaderboard-info">
                      <span className="discover-leaderboard-title">{entry.title}</span>
                      <span className="discover-leaderboard-meta">
                        {entry.creator.name} &bull; {entry.engagementScore} {t('engagement_label')}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="discover-digest-card">
          <h2 className="discover-section-title">
            <MailOutlined /> {t('digest_title')}
          </h2>
          <p className="discover-digest-desc">{t('digest_desc')}</p>
          <div className="discover-digest-form">
            <Input
              type="email"
              placeholder={t('digest_email_placeholder')}
              value={digestEmail}
              onChange={(e) => setDigestEmail(e.target.value)}
              onPressEnter={() => void handleDigestSubscribe()}
              className="mb-2"
            />
            <Button type="primary" block loading={digestSubmitting} onClick={() => void handleDigestSubscribe()}>
              {t('digest_subscribe')}
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<AppLoadingIndicator variant="inline" />}>
      <DiscoverPageContent />
    </Suspense>
  );
}
