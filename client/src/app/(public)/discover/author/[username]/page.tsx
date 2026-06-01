'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Empty, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FeedCard from '@/app/(dashboard)/feed/components/FeedCard';
import FeedCardSkeleton from '@/app/(dashboard)/feed/components/FeedCardSkeleton';
import { socialFeedService, type FeedItem, type PublicAuthorProfile } from '@/services/socialFeedService';
import { useAuthStore } from '@/stores/useAuthStore';
import '@/app/(dashboard)/feed/styles.css';

const PAGE_SIZE = 10;

export default function DiscoverAuthorPage() {
  const t = useTranslations('discover');
  const tf = useTranslations('feed');
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = typeof params?.username === 'string' ? params.username.replace(/^@/, '') : '';
  const { isAuthenticated } = useAuthStore();
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  const [profile, setProfile] = useState<PublicAuthorProfile | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const loadProfile = useCallback(
    async (offset: number, append: boolean) => {
      if (!username) return;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await socialFeedService.getPublicAuthorProfile(username, {
          limit: PAGE_SIZE,
          offset,
        });
      setProfile(res);
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setHasMore(offset + res.items.length < res.total);
      setFollowing(Boolean(res.isFollowing));
      } catch {
        if (!append) {
          setProfile(null);
          setItems([]);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [username],
  );

  useEffect(() => {
    void loadProfile(0, false);
  }, [loadProfile]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spin size="large" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Empty description={t('author_not_found')}>
        <Button onClick={() => router.push('/discover')}>{t('back_to_discover')}</Button>
      </Empty>
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

      <section className="discover-author-hero">
        <Avatar size={72} src={profile.author.avatarUrl}>
          {profile.author.name.charAt(0).toUpperCase()}
        </Avatar>
        <div>
          <h1 className="discover-author-name">{profile.author.name}</h1>
          {profile.author.username ? (
            <p className="discover-author-handle">@{profile.author.username}</p>
          ) : null}
          {profile.author.title ? (
            <p className="discover-author-title">{profile.author.title}</p>
          ) : null}
          <div className="discover-author-stats">
            <span>{t('author_posts', { count: profile.stats.post_count })}</span>
            <span>{t('author_views', { count: profile.stats.total_views })}</span>
            <span>{t('author_followers', { count: profile.stats.follower_count })}</span>
          </div>
          {!isAuthenticated ? (
            <Link href={`/login?next=${encodeURIComponent(`/discover/author/${username}`)}`}>
              <Button type="primary" className="mt-3">
                {t('follow_sign_in')}
              </Button>
            </Link>
          ) : profile.author.id ? (
            <Button
              type={following ? 'default' : 'primary'}
              className="mt-3"
              loading={followPending}
              onClick={() => {
                setFollowPending(true);
                void socialFeedService
                  .toggleFollowAuthor(profile.author.id)
                  .then((res) => {
                    setFollowing(res.isFollowing);
                  })
                  .finally(() => setFollowPending(false));
              }}
            >
              {following ? tf('scope_following') : tf('follow_button_plus')}
            </Button>
          ) : null}
        </div>
      </section>

      {items.length === 0 ? (
        <Empty description={t('author_empty')} />
      ) : (
        <div className="discover-feed-list">
          {items.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              detailBasePath="/discover"
              hideInteractions={!isAuthenticated}
            />
          ))}
          {hasMore ? (
            <div className="flex justify-center py-4">
              <Button loading={loadingMore} onClick={() => void loadProfile(items.length, true)}>
                {t('load_more')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
