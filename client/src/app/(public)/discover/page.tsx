'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Spin, message } from 'antd';
import { TrophyOutlined, FireOutlined, MailOutlined, SearchOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FeedCard from '@/app/(dashboard)/feed/components/FeedCard';
import FeedCardSkeleton from '@/app/(dashboard)/feed/components/FeedCardSkeleton';
import { socialFeedService, type FeedItem, type FeedLeaderboardItem } from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';
import '@/app/(dashboard)/feed/styles.css';

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
  const [digestEmail, setDigestEmail] = useState('');
  const [digestSubmitting, setDigestSubmitting] = useState(false);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await socialFeedService.getPublicFeed({
        sort: 'recommended',
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setHasMore(offset + res.items.length < res.total);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search]);

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  useEffect(() => {
    void socialFeedService.getPublicTrendingFeed({ limit: 4, timeWindowDays: 7 }).then((res) => {
      setTrending(res.items);
    });
    void socialFeedService.getPublicLeaderboard(6).then((res) => {
      setLeaderboard(res.items);
    });
  }, []);

  useEffect(() => {
    const token = searchParams.get('unsubscribe');
    if (!token) return;
    void socialFeedService
      .unsubscribeDigest(token)
      .then((res) => message.success(res.message || t('digest_unsubscribed')))
      .catch(() => message.error(t('digest_unsubscribe_failed')));
  }, [searchParams, t]);

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
    <>
      <section className="discover-hero">
        <h1 className="discover-hero-title">{t('hero_title')}</h1>
        <p className="discover-hero-desc">{t('hero_desc')}</p>
        {!isAuthenticated ? (
          <div className="discover-signin-cta">
            <p>{t('sign_in_cta')}</p>
            <Link href="/login?mode=signup">
              <Button type="primary" size="large">
                {t('sign_up_free')}
              </Button>
            </Link>
          </div>
        ) : null}
      </section>

      {leaderboard.length > 0 && !search.trim() ? (
        <section className="discover-leaderboard mb-6">
          <h2 className="discover-section-title">
            <TrophyOutlined /> {t('leaderboard_title')}
          </h2>
          <ol className="discover-leaderboard-list">
            {leaderboard.map((entry) => (
              <li key={entry.id}>
                <Link href={`/discover/${entry.postId}`} className="discover-leaderboard-row">
                  <span className="discover-leaderboard-rank">#{entry.rank}</span>
                  <span className="discover-leaderboard-title">{entry.title}</span>
                  <span className="discover-leaderboard-meta">
                    {entry.creator.name} · {entry.engagementScore} {t('engagement_label')}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {trending.length > 0 && !search.trim() ? (
        <section className="discover-trending mb-6">
          <h2 className="discover-section-title">
            <FireOutlined /> {t('trending_title')}
          </h2>
          <div className="discover-trending-grid">
            {trending.map((item) => (
              <Link key={item.id} href={`/discover/${item.id}`} className="discover-trending-card">
                <span className="discover-trending-card-title">{item.title}</span>
                <span className="discover-trending-card-meta">
                  {item.author.name} · {item.metrics.views} {t('views_label')}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mb-4">
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('search_placeholder')}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onPressEnter={() => setSearch(searchDraft)}
          allowClear
        />
      </div>

      {loading ? (
        <div className="discover-feed-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <FeedCardSkeleton key={`sk-${i}`} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty description={t('empty')} />
      ) : (
        <div className="discover-feed-list">
          {items.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              detailBasePath="/discover"
              hideInteractions={!isAuthenticated}
              compact={false}
            />
          ))}
          {hasMore ? (
            <div className="flex justify-center py-4">
              <Button loading={loadingMore} onClick={() => void loadPage(items.length, true)}>
                {t('load_more')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <section className="discover-digest mt-8">
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
          />
          <Button type="primary" loading={digestSubmitting} onClick={() => void handleDigestSubscribe()}>
            {t('digest_subscribe')}
          </Button>
        </div>
      </section>
    </>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spin size="large" />
        </div>
      }
    >
      <DiscoverPageContent />
    </Suspense>
  );
}
