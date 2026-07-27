'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Tag, message, Alert } from 'antd';
import {
  ArrowUpOutlined,
  BulbOutlined,
  CompassOutlined,
  DashboardOutlined,
  DownOutlined,
  FireOutlined,
  MessageOutlined,
  ShareAltOutlined,
  TeamOutlined,
  UserAddOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';
import { DashboardPageHeader } from '@/components/layout/DashboardPageShell';

/** Feed publication moderation queue — hidden until re-enabled. */
const SHOW_FEED_APPROVALS_UI = false;

import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useFeedFiltersStore } from '@/stores/useFeedFiltersStore';
import FeedFilters from './components/FeedFilters';
import FeedCard from './components/FeedCard';
import FeedGridCard from './components/FeedGridCard';
import FeedCardSkeleton from './components/FeedCardSkeleton';
import FeedDiscoveryDrawer from '@/components/Feed/FeedDiscoveryDrawer';
import { formatTimeAgo, socialFeedService } from '@/services/socialFeedService';
import { consumeFeedHighlight, resolveFeedHighlightPostId } from '@/components/Feed/feedHighlight';
import { useFeedInteractions } from '@/hooks/feed/useFeedInteractions';
import { errorMessage } from '@/hooks/feed/feedInteractionUtils';
import {
  EMPTY_FILTER_OPTIONS,
  EMPTY_SIDEBAR_DATA,
  feedKeys,
  useApprovalQueueQuery,
  useApprovePublicationMutation,
  useFeedFilterOptionsQuery,
  useFeedItemsCacheSetter,
  useFeedListQuery,
  useFeedSidebarQuery,
  useRejectPublicationMutation,
  usePrependFeedItem,
  type FeedRequestFilters,
} from '@/hooks/feed/useFeedQueries';
import { useTranslations } from 'next-intl';

const FEED_SKELETON_COUNT = 4;
const FEED_SKELETON_APPEND_COUNT = 2;

const SocialFeedPage: React.FC = () => {
  const t = useTranslations('feed_page');
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const queryPostId = searchParams.get('post') || '';
  const highlightPostId = useMemo(() => resolveFeedHighlightPostId(queryPostId), [queryPostId]);
  const { user } = useAuth();

  // ─── Shared filter/sidebar-control UI state (Zustand — read by FeedFilters,
  // FeedDiscoveryDrawer) ───────────────────────────────────
  const filters = useFeedFiltersStore((s) => s.filters);
  const sidebarControls = useFeedFiltersStore((s) => s.sidebarControls);
  const setFilters = useFeedFiltersStore((s) => s.setFilters);
  const addTagFilter = useFeedFiltersStore((s) => s.addTagFilter);
  const setSidebarTimeRange = useFeedFiltersStore((s) => s.setSidebarTimeRange);
  const setSidebarContentType = useFeedFiltersStore((s) => s.setSidebarContentType);
  const setSidebarSortBy = useFeedFiltersStore((s) => s.setSidebarSortBy);

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(filters.search || ''), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  const requestFilters: FeedRequestFilters = useMemo(
    () => ({
      scope: filters.scope,
      assetType: filters.assetType,
      sort: filters.sort,
      tags: filters.tags,
      search: debouncedSearch,
    }),
    [debouncedSearch, filters.assetType, filters.scope, filters.sort, filters.tags]
  );

  // ─── Server data (React Query) ────────────────────────────────────────────
  const feedQuery = useFeedListQuery(requestFilters);
  const { items } = feedQuery;
  const loading = feedQuery.isLoading || feedQuery.isFetchingNextPage;

  const filterOptionsQuery = useFeedFilterOptionsQuery(filters.scope);
  const filterOptions = filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS;

  const sidebarQuery = useFeedSidebarQuery(filters.scope, sidebarControls);
  const sidebarData = sidebarQuery.data ?? EMPTY_SIDEBAR_DATA;

  const refreshSidebar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: feedKeys.sidebar(filters.scope, sidebarControls) });
  }, [filters.scope, queryClient, sidebarControls]);

  const { pendingInteractions, handleReact, handleSave, handleToggleFollow, handleDeleteItem } = useFeedInteractions(
    items,
    useFeedItemsCacheSetter(requestFilters),
    { onSidebarRefresh: refreshSidebar }
  );

  const { approvalQueue, canModerateApprovals, accessResolved: approvalAccessResolved, isLoading: loadingApprovals } =
    useApprovalQueueQuery({ enabled: SHOW_FEED_APPROVALS_UI });
  const approveMutation = useApprovePublicationMutation();
  const rejectMutation = useRejectPublicationMutation();

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const itemsRef = useRef<typeof items>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [focusedPostIndex, setFocusedPostIndex] = useState<number>(-1);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const latestItemIdRef = useRef<string | null>(null);
  const endFeedActionRef = useRef<HTMLDivElement | null>(null);
  const [showEndFeedAction, setShowEndFeedAction] = useState(false);
  const [refreshingFromEndAction, setRefreshingFromEndAction] = useState(false);
  const [endFeedActionInteracted, setEndFeedActionInteracted] = useState(false);
  const [resolvedHighlightId, setResolvedHighlightId] = useState<string | null>(null);
  const highlightScrolledRef = useRef(false);
  const highlightFetchRef = useRef<string | null>(null);
  const prependFeedItem = usePrependFeedItem(requestFilters);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const scrollFeedToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    wrapperRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
    document.documentElement?.scrollTo?.({ top: 0, behavior });
    document.body?.scrollTo?.({ top: 0, behavior });
  }, []);

  const resetFeedToFirstPage = useCallback(() => {
    return queryClient.resetQueries({ queryKey: feedKeys.list(requestFilters) });
  }, [queryClient, requestFilters]);

  const handleScrollToTop = useCallback(async () => {
    if (refreshingFromEndAction || loading) return;
    setRefreshingFromEndAction(true);
    setShowEndFeedAction(false);
    scrollFeedToTop('smooth');
    try {
      await resetFeedToFirstPage();
      requestAnimationFrame(() => {
        scrollFeedToTop('auto');
        setTimeout(() => scrollFeedToTop('auto'), 80);
      });
    } finally {
      setRefreshingFromEndAction(false);
    }
  }, [loading, refreshingFromEndAction, resetFeedToFirstPage, scrollFeedToTop]);

  const handleTagFilter = useCallback(
    (tag: string) => {
      addTagFilter(tag);
    },
    [addTagFilter]
  );

  // ─── Track latest post id after initial load for new-posts polling ────────
  useEffect(() => {
    if (items.length > 0 && !latestItemIdRef.current) {
      latestItemIdRef.current = items[0]?.id ?? null;
    }
  }, [items]);

  // Poll every 60s for new posts and show a banner (deliberately a lightweight
  // background check, not a refetch of the main list — keeps reading position stable).
  useEffect(() => {
    if (!filters.scope) return;
    const interval = window.setInterval(async () => {
      if (!latestItemIdRef.current) return;
      try {
        const response = await socialFeedService.getFeed({
          scope: filters.scope,
          sort: 'recent',
          limit: 5,
          offset: 0,
        });
        const newItems = response.items ?? [];
        if (newItems.length > 0 && newItems[0].id !== latestItemIdRef.current) {
          const existingIds = new Set(itemsRef.current.map((i) => i.id));
          const fresh = newItems.filter((i) => !existingIds.has(i.id));
          if (fresh.length > 0) setNewPostsCount(fresh.length);
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [filters.scope]);

  // ─── Keyboard navigation: j=next, k=prev, o=open post ────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedPostIndex((prev) => {
          const next = Math.min(prev + 1, itemsRef.current.length - 1);
          const postEl = document.getElementById(`feed-post-${itemsRef.current[next]?.id}`);
          postEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return next;
        });
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedPostIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          const postEl = document.getElementById(`feed-post-${itemsRef.current[next]?.id}`);
          postEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return next;
        });
      } else if ((e.key === 'o' || e.key === 'Enter') && focusedPostIndex >= 0) {
        const item = itemsRef.current[focusedPostIndex];
        if (item?.id) router.push(`/feed/${item.id}`);
      } else if (e.key === 'Escape') {
        setFocusedPostIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusedPostIndex, router]);

  useEffect(() => {
    if (!highlightPostId) return;
    highlightScrolledRef.current = false;
    highlightFetchRef.current = null;
  }, [highlightPostId]);

  useEffect(() => {
    if (!highlightPostId || loading) return;

    const scrollToPost = (postId: string, attempt = 0) => {
      if (highlightScrolledRef.current) return;
      const el = document.getElementById(`feed-post-${postId}`);
      if (el) {
        highlightScrolledRef.current = true;
        setResolvedHighlightId(postId);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        consumeFeedHighlight();
        if (queryPostId) {
          window.setTimeout(() => router.replace('/feed', { scroll: false }), 400);
        }
        window.setTimeout(() => setResolvedHighlightId(null), 3000);
        return;
      }
      if (attempt < 12) {
        window.setTimeout(() => scrollToPost(postId, attempt + 1), 120);
      }
    };

    if (items.some((item) => item.id === highlightPostId)) {
      window.setTimeout(() => scrollToPost(highlightPostId), 80);
      return;
    }

    if (highlightFetchRef.current === highlightPostId) return;
    highlightFetchRef.current = highlightPostId;

    let active = true;
    socialFeedService
      .getItemById(highlightPostId)
      .then((post) => {
        if (!active || !post) return;
        prependFeedItem(post);
        window.setTimeout(() => scrollToPost(post.id), 120);
      })
      .catch(() => {
        // One-shot deep-link resolution (e.g. a shared /feed?post= link), not a
        // repeating background process — unlike the 60s poll above, a failure here
        // has no next attempt, so it needs to be visible instead of silent.
        if (active) message.error(t('feed_highlight_load_failed', { defaultMessage: "Couldn't load that post." }));
      });

    return () => {
      active = false;
    };
  }, [highlightPostId, items, loading, prependFeedItem, queryPostId, router]);

  useEffect(() => {
    const root = wrapperRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
          void feedQuery.fetchNextPage();
        }
      },
      { root, rootMargin: '200px 0px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [feedQuery]);

  useEffect(() => {
    if (feedQuery.hasNextPage || items.length === 0 || loading) {
      setShowEndFeedAction(false);
    }
  }, [feedQuery.hasNextPage, items.length, loading]);

  useEffect(() => {
    if (showEndFeedAction && !refreshingFromEndAction) {
      setEndFeedActionInteracted(false);
    }
  }, [showEndFeedAction, refreshingFromEndAction]);

  useEffect(() => {
    const root = wrapperRef.current;
    const endAction = endFeedActionRef.current;
    if (!root || !endAction || feedQuery.hasNextPage || items.length === 0 || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setShowEndFeedAction(Boolean(entry?.isIntersecting));
      },
      { root, threshold: 0.15 }
    );

    observer.observe(endAction);
    return () => observer.disconnect();
  }, [feedQuery.hasNextPage, items.length, loading]);

  const handleApprovePublication = useCallback(
    (queueItemId: string) => {
      const entry = approvalQueue.find((item) => item.id === queueItemId);
      approveMutation.mutate(queueItemId, {
        onSuccess: () => {
          message.success(t('publication_approved'));
          if (entry?.item?.id) {
            router.push(`/feed?post=${encodeURIComponent(entry.item.id)}`);
          }
        },
        onError: (error) => message.error(errorMessage(error, t('unable_approve_publication'))),
      });
    },
    [approvalQueue, approveMutation, router, t]
  );

  const openRejectModal = useCallback((queueItemId: string) => {
    setRejectTargetId(queueItemId);
    setRejectReason('');
  }, []);

  const closeRejectModal = useCallback(() => {
    if (rejectMutation.isPending) return;
    setRejectTargetId(null);
    setRejectReason('');
  }, [rejectMutation.isPending]);

  const handleRejectPublication = useCallback(() => {
    const queueItemId = rejectTargetId;
    if (!queueItemId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      message.warning(t('rejection_reason_required'));
      return;
    }

    rejectMutation.mutate(
      { queueItemId, reason },
      {
        onSuccess: () => {
          message.success(t('publication_rejected'));
          setRejectTargetId(null);
          setRejectReason('');
        },
        onError: (error) => message.error(errorMessage(error, t('unable_reject_publication'))),
      }
    );
  }, [rejectMutation, rejectReason, rejectTargetId, t]);

  const searchQuery = (filters.search || '').trim();
  const hasSearchFilter = searchQuery.length > 0;
  const hasTagFilters = filters.tags.length > 0;
  const hasAssetFilter = filters.assetType !== 'all';
  const defaultScope = isEnterpriseEdition() ? 'organization' : 'public';
  const hasScopeFilter = filters.scope !== defaultScope;
  const showContextualEmptyState = hasSearchFilter || hasTagFilters || hasAssetFilter || hasScopeFilter;

  const scopeLabel = useMemo(() => {
    switch (filters.scope) {
      case 'private':
        return t('scope_private');
      case 'following':
        return t('scope_following');
      case 'project':
        return t('scope_project');
      case 'public':
        return t('scope_public');
      case 'organization':
      default:
        return t('scope_organization');
    }
  }, [filters.scope, t]);

  const assetLabel = useMemo(() => {
    switch (filters.assetType) {
      case 'dashboard':
        return t('asset_dashboard_posts');
      case 'chart':
        return t('asset_chart_posts');
      case 'insight':
        return t('asset_insight_posts');
      case 'query':
        return t('asset_query_posts');
      case 'all':
      default:
        return t('asset_posts');
    }
  }, [filters.assetType, t]);

  const emptyStateTitle = showContextualEmptyState
    ? t('empty_title_filtered', { asset: assetLabel, scope: scopeLabel })
    : t('empty_title_default');

  const emptyStateSubtitle = useMemo(() => {
    if (hasSearchFilter) {
      return t('empty_sub_search', { asset: assetLabel, scope: scopeLabel, query: searchQuery });
    }
    if (hasTagFilters) {
      return t('empty_sub_tags', { asset: assetLabel, scope: scopeLabel });
    }
    if (showContextualEmptyState) {
      return t('empty_sub_try_filters');
    }
    return t('empty_sub_default');
  }, [assetLabel, hasSearchFilter, hasTagFilters, scopeLabel, searchQuery, showContextualEmptyState, t]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto bg-[var(--ant-color-bg-layout)] px-4 sm:px-6 text-[var(--ant-color-text)]">
      <div className="sticky top-0 z-40 bg-[var(--ant-color-bg-layout)] pt-4">
        <div className="w-full">
          <FeedFilters value={filters} options={filterOptions} onChange={setFilters} />
        </div>
        {highlightPostId && !resolvedHighlightId ? (
          <Alert type="info" showIcon message={t('finding_post')} className="mt-3" />
        ) : null}
      </div>

      <div className="mt-5 flex min-w-0 flex-col pb-10">
        <div className="w-full max-w-[1600px] mx-auto">
              {/* New posts available banner */}
              {newPostsCount > 0 && !loading && (
                <div className="mb-4 flex justify-center">
                  <Button
                    type="primary"
                    icon={<ArrowDownOutlined />}
                    className="flex items-center gap-2 rounded-full px-5 py-2 h-auto text-sm font-medium shadow-sm transition-all hover:translate-y-[-1px]"
                    onClick={() => {
                      setNewPostsCount(0);
                      latestItemIdRef.current = null;
                      void resetFeedToFirstPage();
                    }}
                  >
                    {newPostsCount === 1 ? t('one_new_post') : t('n_new_posts', { count: newPostsCount })}
                  </Button>
                </div>
              )}

              {SHOW_FEED_APPROVALS_UI && approvalAccessResolved && canModerateApprovals && (
                <div className="mb-6 rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-base font-semibold text-[var(--ant-color-text)] m-0">
                      {t('pending_approvals')}
                    </h2>
                    {approvalQueue.length > 0 ? (
                      <Tag color="gold" className="m-0 border-0 font-medium">
                        {approvalQueue.length}
                      </Tag>
                    ) : null}
                  </div>

                  {loadingApprovals && (
                    <div className="flex flex-col items-center justify-center p-6 text-center text-sm text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-bg-layout)] border border-dashed border-[var(--ant-color-border-secondary)] rounded-xl">
                      {t('loading_approval_queue')}
                    </div>
                  )}

                  {!loadingApprovals && approvalQueue.length === 0 && (
                    <div className="flex flex-col items-center justify-center p-6 text-center text-sm text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-bg-layout)] border border-dashed border-[var(--ant-color-border-secondary)] rounded-xl">
                      {t('no_pending_publications')}
                    </div>
                  )}

                  {!loadingApprovals && approvalQueue.length > 0 && (
                    <div className="flex flex-col gap-4">
                      {approvalQueue.map((entry) => {
                        const isApproving = approveMutation.isPending && approveMutation.variables === entry.id;
                        const isRejecting = rejectMutation.isPending && rejectMutation.variables?.queueItemId === entry.id;
                        const submittedText = formatTimeAgo(entry.submittedAt);
                        const visibilityLabel = entry.visibility.charAt(0).toUpperCase() + entry.visibility.slice(1);
                        return (
                          <div
                            key={`approval-${entry.id}`}
                            className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-xl shadow-sm overflow-hidden flex flex-col relative group"
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400"></div>
                            <div className="pl-4">
                              <FeedCard item={entry.item} compact hideInteractions />
                            </div>
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-[var(--ant-color-bg-layout)] border-t border-[var(--ant-color-border-secondary)] mt-2">
                              <div className="flex items-center gap-2 text-sm text-[var(--ant-color-text-secondary)]">
                                <span className="font-medium text-[var(--ant-color-text)]">
                                  {t('submitted_time', { submittedText })}
                                </span>
                                <span className="text-[var(--ant-color-text-description)]">&middot;</span>
                                <span className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] px-2 py-0.5 rounded text-xs font-semibold">
                                  {visibilityLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  className="h-9 rounded-lg font-medium"
                                  loading={isRejecting}
                                  disabled={isApproving}
                                  onClick={() => openRejectModal(entry.id)}
                                >
                                  {t('reject')}
                                </Button>
                                <Button
                                  type="primary"
                                  className="h-9 rounded-lg font-medium"
                                  loading={isApproving}
                                  disabled={isRejecting}
                                  onClick={() => handleApprovePublication(entry.id)}
                                >
                                  {t('approve')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {items.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-xl shadow-sm my-6">
                  <h3 className="m-0 text-base font-semibold text-[var(--ant-color-text)]">
                    {emptyStateTitle}
                  </h3>
                  {showContextualEmptyState && (
                    <p className="m-0 text-sm text-[var(--ant-color-text-secondary)] max-w-md">
                      {emptyStateSubtitle}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
                    <Button
                      type="primary"
                      icon={<MessageOutlined />}
                      className="rounded-lg font-medium"
                      onClick={() => router.push(getChatHref({ prompt: t('explore_prompt_question') }))}
                    >
                      {t('empty_cta_explore_ai')}
                    </Button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'discover', icon: <CompassOutlined />, label: t('discover') },
                          { key: 'trending', icon: <FireOutlined />, label: t('explore_chip_trending') },
                          { key: 'team', icon: <TeamOutlined />, label: t('explore_chip_team') },
                          { key: 'learn', icon: <BulbOutlined />, label: t('explore_chip_learn') },
                          { key: 'build_dashboard', icon: <DashboardOutlined />, label: t('build_dashboard') },
                          { key: 'share', icon: <ShareAltOutlined />, label: t('explore_chip_share_insight') },
                        ],
                        onClick: ({ key }) => {
                          switch (key) {
                            case 'discover':
                              setDiscoveryOpen(true);
                              break;
                            case 'trending':
                              setFilters({ ...filters, sort: 'trending', scope: defaultScope });
                              break;
                            case 'team':
                              setFilters({ ...filters, scope: defaultScope, sort: 'recommended' });
                              break;
                            case 'learn':
                              router.push(getChatHref({ prompt: t('explore_prompt_learn') }));
                              break;
                            case 'build_dashboard':
                              router.push('/dashboards');
                              break;
                            case 'share':
                              router.push('/feed/publish');
                              break;
                            default:
                              break;
                          }
                        },
                      }}
                    >
                      <Button className="rounded-lg font-medium">
                        {t('explore_more')} <DownOutlined />
                      </Button>
                    </Dropdown>
                  </div>
                  {!user && (
                    <Button
                      type="link"
                      icon={<UserAddOutlined />}
                      className="font-medium"
                      onClick={() => router.push('/login')}
                    >
                      {t('sign_in_to_save')}
                    </Button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4">
                {items.map((item, idx) => (
                  <FeedGridCard
                    key={item.id}
                    item={item}
                    highlighted={resolvedHighlightId === item.id || focusedPostIndex === idx}
                    onReact={handleReact}
                    onSave={handleSave}
                    onToggleFollow={handleToggleFollow}
                    onDeleteItem={handleDeleteItem}
                    interactionState={pendingInteractions[item.id]}
                  />
                ))}
                {loading &&
                  Array.from({ length: items.length === 0 ? FEED_SKELETON_COUNT : FEED_SKELETON_APPEND_COUNT }).map(
                    (_, index) => (
                      <FeedCardSkeleton
                        key={`feed-skeleton-${items.length === 0 ? 'initial' : 'append'}-${index}`}
                        compact
                      />
                    )
                  )}
                <div ref={sentinelRef} className="col-span-full h-4" />
                {!feedQuery.hasNextPage && items.length > 0 && !loading && (
                  <div
                    ref={endFeedActionRef}
                    className={`col-span-full flex flex-col items-center gap-4 py-8 transition-all duration-300 ${
                      showEndFeedAction ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
                    }`}
                  >
                    <div className="flex items-center gap-3 w-full max-w-xs text-[11px] text-[var(--ant-color-text-secondary)] font-semibold uppercase tracking-wider">
                      <span className="flex-1 h-px bg-[var(--ant-color-border-secondary)]" />
                      <span>{t('end_of_feed')}</span>
                      <span className="flex-1 h-px bg-[var(--ant-color-border-secondary)]" />
                    </div>
                    <Button
                      icon={<ArrowUpOutlined className={refreshingFromEndAction ? 'animate-spin' : ''} />}
                      loading={refreshingFromEndAction}
                      disabled={refreshingFromEndAction}
                      onMouseEnter={() => setEndFeedActionInteracted(true)}
                      onFocus={() => setEndFeedActionInteracted(true)}
                      onClick={() => {
                        setEndFeedActionInteracted(true);
                        void handleScrollToTop();
                      }}
                      className={`rounded-full h-10 px-6 font-medium shadow-sm transition-all hover:-translate-y-0.5 ${
                        showEndFeedAction && !refreshingFromEndAction && !endFeedActionInteracted ? 'animate-pulse' : ''
                      }`}
                    >
                      {refreshingFromEndAction ? t('refreshing_feed') : t('back_to_top_and_refresh')}
                    </Button>
                  </div>
                )}
              </div>
        </div>
      </div>
      <FeedDiscoveryDrawer
        open={discoveryOpen}
        onClose={() => setDiscoveryOpen(false)}
        data={sidebarData}
        loading={sidebarQuery.isLoading}
        timeRange={sidebarControls.timeRange}
        contentType={sidebarControls.contentType}
        sortBy={sidebarControls.sortBy}
        onChangeTimeRange={setSidebarTimeRange}
        onChangeContentType={setSidebarContentType}
        onChangeSortBy={setSidebarSortBy}
        onOpenItem={(postId) => router.push(`/feed/${postId}`)}
        onLikeItem={(postId) => void handleReact(postId, 'like')}
        onSaveItem={(postId) => void handleSave(postId)}
        onTagClick={(tag) => {
          handleTagFilter(tag);
          setDiscoveryOpen(false);
        }}
      />
      {SHOW_FEED_APPROVALS_UI ? (
        <Modal
          title={
            <div className="flex items-center gap-2 text-[var(--ant-color-error)]">
              <span className="text-lg font-semibold text-[var(--ant-color-text)] border-b border-[var(--ant-color-border-secondary)] pb-2 block w-full mb-2">
                {t('reject_publication')}
              </span>
            </div>
          }
          open={Boolean(rejectTargetId)}
          okText={t('reject')}
          okType="danger"
          okButtonProps={{
            className: 'bg-[var(--ant-color-error)] hover:bg-[var(--ant-color-error-hover)] h-9 font-medium shadow-sm',
          }}
          cancelButtonProps={{ className: 'h-9 font-medium hover:bg-[var(--ant-color-bg-layout)] transition-colors' }}
          confirmLoading={rejectMutation.isPending}
          onCancel={closeRejectModal}
          onOk={handleRejectPublication}
          className="rounded-xl overflow-hidden"
        >
          <p className="text-sm font-medium text-[var(--ant-color-text)] mb-2 mt-4">{t('reason_for_rejection')}</p>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            value={rejectReason}
            maxLength={500}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder={t('reason_rejection_placeholder')}
            className="rounded-lg border-[var(--ant-color-border)] focus:border-[var(--ant-color-error)] hover:border-[var(--ant-color-border-secondary)] text-sm py-2 px-3"
          />
          <div
            className={`text-right mt-1.5 text-xs ${
              rejectReason.length > 450 ? 'text-[var(--ant-color-error)]' : 'text-[var(--ant-color-text-description)]'
            }`}
          >
            {rejectReason.length}/500
          </div>
        </Modal>
      ) : null}
    </div>
  );
};

export default SocialFeedPage;
