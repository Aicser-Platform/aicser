'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Tag, message, Alert } from 'antd';
import {
  ArrowUpOutlined,
  CompassOutlined,
  DashboardOutlined,
  MessageOutlined,
  UserAddOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';

import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';

import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import FeedFilters, { FeedFiltersValue } from './components/FeedFilters';
import FeedPageActions from './components/FeedPageActions';
import FeedExploreStrip, { type FeedExploreAction } from './components/FeedExploreStrip';
import FeedCard from './components/FeedCard';
import FeedSidebar from './components/FeedSidebar';
import FeedCardSkeleton from './components/FeedCardSkeleton';
import FeedDiscoveryDrawer from '@/components/Feed/FeedDiscoveryDrawer';
import { formatTimeAgo, socialFeedService } from '@/services/socialFeedService';
import { consumeFeedHighlight, resolveFeedHighlightPostId } from '@/components/Feed/feedHighlight';
import type {
  ApprovalQueueItem,
  AssetType,
  FeedFilterOptions,
  FeedItem,
  FeedSidebarData,
  LeaderboardSortBy,
  LeaderboardTimeRange,
} from '@/services/socialFeedService';
import { ApiError } from '@/utils/api';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useFeedInteractions } from '@/hooks/feed/useFeedInteractions';
import { errorMessage } from '@/hooks/feed/feedInteractionUtils';
import './styles.css';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 10;
const APPROVAL_QUEUE_PAGE_SIZE = 20;
const EMPTY_FILTER_OPTIONS: FeedFilterOptions = {
  tags: [],
  authors: [],
  assetCounts: { dashboard: 0, chart: 0, insight: 0, query: 0 },
};
const EMPTY_SIDEBAR_DATA: FeedSidebarData = {
  leaderboard: [],
  topContributors: [],
  recommended: [],
  trendingTags: [],
  collections: [],
  activity: [],
};
type SidebarControls = {
  timeRange: LeaderboardTimeRange;
  contentType: AssetType | 'all';
  sortBy: LeaderboardSortBy;
};
const FEED_SKELETON_COUNT = 4;
const FEED_SKELETON_APPEND_COUNT = 2;
type ApprovalDecisionAction = 'approving' | 'rejecting';

const SocialFeedPage: React.FC = () => {
  const t = useTranslations('feed_page');
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryPostId = searchParams.get('post') || '';
  const highlightPostId = useMemo(() => resolveFeedHighlightPostId(queryPostId), [queryPostId]);
  const { user } = useAuth();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FeedFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [sidebarData, setSidebarData] = useState<FeedSidebarData>(EMPTY_SIDEBAR_DATA);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarControls, setSidebarControls] = useState<SidebarControls>({
    timeRange: 'week',
    contentType: 'all',
    sortBy: 'popular',
  });
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState<ApprovalQueueItem[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [canModerateApprovals, setCanModerateApprovals] = useState(false);
  const [approvalAccessResolved, setApprovalAccessResolved] = useState(false);
  const [approvalPending, setApprovalPending] = useState<Record<string, Record<ApprovalDecisionAction, boolean>>>({});
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const [filters, setFilters] = useState<FeedFiltersValue>({
    scope: isEnterpriseEdition() ? 'organization' : 'public',
    assetType: 'all',
    sort: 'recommended',
    tags: [],
    search: '',
  });

  const itemsRef = useRef<FeedItem[]>([]);
  const loadingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [focusedPostIndex, setFocusedPostIndex] = useState<number>(-1);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const latestItemIdRef = useRef<string | null>(null);
  const endFeedActionRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [showEndFeedAction, setShowEndFeedAction] = useState(false);
  const [refreshingFromEndAction, setRefreshingFromEndAction] = useState(false);
  const [endFeedActionInteracted, setEndFeedActionInteracted] = useState(false);
  const [resolvedHighlightId, setResolvedHighlightId] = useState<string | null>(null);
  const highlightScrolledRef = useRef(false);
  const highlightFetchRef = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const scrollFeedToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    wrapperRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
    document.documentElement?.scrollTo?.({ top: 0, behavior });
    document.body?.scrollTo?.({ top: 0, behavior });
  }, []);

  const handleFiltersChange = useCallback((next: FeedFiltersValue) => {
    setFilters(next);
  }, []);

  const handleTagFilter = useCallback((tag: string) => {
    setFilters((prev) => {
      const tags = prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag];
      return { ...prev, tags };
    });
  }, []);

  const loadFeed = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current && !reset) return;

      const requestId = ++requestIdRef.current;
      loadingRef.current = true;
      setLoading(true);

      if (reset) {
        itemsRef.current = [];
        setItems([]);
        setHasMore(true);
        wrapperRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }

      try {
        const offset = reset ? 0 : itemsRef.current.length;
        const response = await socialFeedService.getFeed({
          scope: filters.scope,
          sort: filters.sort,
          tags: filters.tags,
          search: (filters.search || '').trim() || undefined,
          assetType: filters.assetType === 'all' ? undefined : filters.assetType,
          limit: PAGE_SIZE,
          offset,
        });

        if (requestId !== requestIdRef.current) return;

        const items = response.items ?? [];
        const nextItems = reset ? items : [...itemsRef.current, ...items];
        itemsRef.current = nextItems;
        setItems(nextItems);
        const hasValidTotal =
          typeof response.total === 'number' && Number.isFinite(response.total) && response.total >= 0;
        const hasMoreByTotal = hasValidTotal ? nextItems.length < response.total : true;
        const hasMoreByPage = items.length >= PAGE_SIZE;
        setHasMore(hasMoreByTotal && hasMoreByPage);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        message.error(errorMessage(error, t('failed_load_feed')));
      } finally {
        if (requestId !== requestIdRef.current) return;
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filters]
  );

  const handleScrollToTop = useCallback(async () => {
    if (refreshingFromEndAction || loadingRef.current) return;
    setRefreshingFromEndAction(true);
    setShowEndFeedAction(false);
    scrollFeedToTop('smooth');
    try {
      await loadFeed(true);
      requestAnimationFrame(() => {
        scrollFeedToTop('auto');
        setTimeout(() => scrollFeedToTop('auto'), 80);
      });
    } finally {
      setRefreshingFromEndAction(false);
    }
  }, [loadFeed, refreshingFromEndAction, scrollFeedToTop]);

  const loadFilterOptions = useCallback(async () => {
    try {
      const response = await socialFeedService.getFilterOptions(filters.scope);
      setFilterOptions({
        tags: response.tags ?? [],
        authors: response.authors ?? [],
        assetCounts: response.assetCounts ?? { dashboard: 0, chart: 0, insight: 0 },
      });
    } catch (error) {
      message.error(errorMessage(error, t('failed_load_filters')));
    }
  }, [filters.scope]);

  const loadSidebar = useCallback(async () => {
    setSidebarLoading(true);
    try {
      const response = await socialFeedService.getSidebarData(filters.scope, {
        timeRange: sidebarControls.timeRange,
        contentType: sidebarControls.contentType,
        sortBy: sidebarControls.sortBy,
        leaderboardLimit: 8,
      });
      setSidebarData({
        leaderboard: response.leaderboard ?? [],
        topContributors: response.topContributors ?? [],
        recommended: response.recommended ?? [],
        trendingTags: response.trendingTags ?? [],
        collections: response.collections ?? [],
        activity: response.activity ?? [],
      });
    } catch (error) {
      message.error(errorMessage(error, t('failed_load_sidebar')));
    } finally {
      setSidebarLoading(false);
    }
  }, [filters.scope, sidebarControls.contentType, sidebarControls.sortBy, sidebarControls.timeRange, t]);

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleToggleFollow,
    handleDeleteItem,
    handleCommentDeleted,
  } = useFeedInteractions(items, setItems, { onSidebarRefresh: loadSidebar });

  const handleSidebarTimeRangeChange = useCallback((value: LeaderboardTimeRange) => {
    setSidebarControls((prev) => ({ ...prev, timeRange: value }));
  }, []);

  const handleSidebarContentTypeChange = useCallback((value: AssetType | 'all') => {
    setSidebarControls((prev) => ({ ...prev, contentType: value }));
  }, []);

  const handleSidebarSortChange = useCallback((value: LeaderboardSortBy) => {
    setSidebarControls((prev) => ({ ...prev, sortBy: value }));
  }, []);

  const setApprovalPendingState = useCallback((itemId: string, action: ApprovalDecisionAction, value: boolean) => {
    setApprovalPending((prev) => {
      const current = prev[itemId] || { approving: false, rejecting: false };
      const next = { ...current, [action]: value };
      if (!next.approving && !next.rejecting) {
        const rest = { ...prev };
        delete rest[itemId];
        return rest;
      }
      return { ...prev, [itemId]: next };
    });
  }, []);

  const removeApprovalQueueItem = useCallback((queueItemId: string) => {
    setApprovalQueue((prev) => prev.filter((entry) => entry.id !== queueItemId));
    setApprovalPending((prev) => {
      if (!(queueItemId in prev)) return prev;
      const rest = { ...prev };
      delete rest[queueItemId];
      return rest;
    });
  }, []);

  const loadApprovalQueue = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const response = await socialFeedService.getApprovalQueue({
        limit: APPROVAL_QUEUE_PAGE_SIZE,
        offset: 0,
      });
      setApprovalQueue(response.items ?? []);
      setCanModerateApprovals(true);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setCanModerateApprovals(false);
        setApprovalQueue([]);
      } else {
        message.error(errorMessage(error, t('failed_load_approval_queue')));
      }
    } finally {
      setLoadingApprovals(false);
      setApprovalAccessResolved(true);
    }
  }, []);

  // ─── Track latest post id after initial load for new-posts polling ────────
  useEffect(() => {
    if (items.length > 0 && !latestItemIdRef.current) {
      latestItemIdRef.current = items[0]?.id ?? null;
    }
  }, [items]);

  // Poll every 60s for new posts and show a banner
  useEffect(() => {
    if (!filters.scope) return;
    const interval = window.setInterval(async () => {
      if (loadingRef.current || !latestItemIdRef.current) return;
      try {
        const response = await socialFeedService.getFeed({
          scope: filters.scope,
          sort: 'recent',
          limit: 5,
          offset: 0,
        });
        const newItems = response.items ?? [];
        if (newItems.length > 0 && newItems[0].id !== latestItemIdRef.current) {
          // Count how many are newer than our current top
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
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;

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
    loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    loadSidebar();
  }, [loadSidebar]);

  useEffect(() => {
    loadApprovalQueue();
  }, [loadApprovalQueue, user?.id]);

  useEffect(() => {
    loadFeed(true);
  }, [filters, loadFeed]);

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
        setItems((prev) => {
          if (prev.some((item) => item.id === post.id)) return prev;
          return [post, ...prev];
        });
        itemsRef.current = [post, ...itemsRef.current.filter((item) => item.id !== post.id)];
        window.setTimeout(() => scrollToPost(post.id), 120);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [highlightPostId, items, loading, queryPostId, router]);

  useEffect(() => {
    const root = wrapperRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadFeed(false);
        }
      },
      { root, rootMargin: '200px 0px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadFeed]);

  useEffect(() => {
    if (hasMore || items.length === 0 || loading) {
      setShowEndFeedAction(false);
    }
  }, [hasMore, items.length, loading]);

  useEffect(() => {
    if (showEndFeedAction && !refreshingFromEndAction) {
      setEndFeedActionInteracted(false);
    }
  }, [showEndFeedAction, refreshingFromEndAction]);

  useEffect(() => {
    const root = wrapperRef.current;
    const endAction = endFeedActionRef.current;
    if (!root || !endAction || hasMore || items.length === 0 || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setShowEndFeedAction(Boolean(entry?.isIntersecting));
      },
      {
        root,
        threshold: 0.15,
      }
    );

    observer.observe(endAction);
    return () => observer.disconnect();
  }, [hasMore, items.length, loading]);

  const handleApprovePublication = useCallback(
    async (queueItemId: string) => {
      if (approvalPending[queueItemId]?.approving) return;
      setApprovalPendingState(queueItemId, 'approving', true);
      try {
        const entry = approvalQueue.find((item) => item.id === queueItemId);
        await socialFeedService.approvePublication(queueItemId);
        removeApprovalQueueItem(queueItemId);
        message.success(t('publication_approved'));
        if (entry?.item?.id) {
          router.push(`/feed?post=${encodeURIComponent(entry.item.id)}`);
        }
      } catch (error) {
        message.error(errorMessage(error, t('unable_approve_publication')));
      } finally {
        setApprovalPendingState(queueItemId, 'approving', false);
      }
    },
    [approvalPending, approvalQueue, removeApprovalQueueItem, router, setApprovalPendingState, t]
  );

  const openRejectModal = useCallback((queueItemId: string) => {
    setRejectTargetId(queueItemId);
    setRejectReason('');
  }, []);

  const closeRejectModal = useCallback(() => {
    if (rejectSubmitting) return;
    setRejectTargetId(null);
    setRejectReason('');
  }, [rejectSubmitting]);

  const handleRejectPublication = useCallback(async () => {
    const queueItemId = rejectTargetId;
    if (!queueItemId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      message.warning(t('rejection_reason_required'));
      return;
    }

    setRejectSubmitting(true);
    setApprovalPendingState(queueItemId, 'rejecting', true);
    try {
      await socialFeedService.rejectPublication(queueItemId, reason);
      removeApprovalQueueItem(queueItemId);
      message.success(t('publication_rejected'));
      setRejectTargetId(null);
      setRejectReason('');
    } catch (error) {
      message.error(errorMessage(error, t('unable_reject_publication')));
    } finally {
      setRejectSubmitting(false);
      setApprovalPendingState(queueItemId, 'rejecting', false);
    }
  }, [rejectReason, rejectTargetId, removeApprovalQueueItem, setApprovalPendingState]);

  const handleExploreAction = useCallback((action: FeedExploreAction) => {
    if (action.type !== 'filters') return;
    setFilters((prev) => ({ ...prev, ...action.patch }));
  }, []);

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
    <DashboardPageShell innerRef={wrapperRef} maxWidth={1400} className="feed-page">
      <div className="feed-page-sticky-bar">
        <DashboardPageHeader
          icon={<CompassOutlined />}
          title={t('page_title')}
          extra={<FeedPageActions onDiscover={() => setDiscoveryOpen(true)} />}
        />
        <div className="w-full">
          <FeedFilters value={filters} options={filterOptions} onChange={handleFiltersChange} />
        </div>
        {highlightPostId && !resolvedHighlightId ? (
          <Alert type="info" showIcon message={t('finding_post')} className="mt-3" />
        ) : null}
      </div>

      <div className="page-body">
      <div className="flex flex-1 w-full pb-10 relative">
        <div className="flex-1 min-w-0 pt-2 flex flex-col items-center">
          <div className="w-full max-w-3xl">
            {/* New posts available banner */}
            {newPostsCount > 0 && !loading && (
              <button
                type="button"
                className="feed-new-posts-banner"
                onClick={() => {
                  setNewPostsCount(0);
                  latestItemIdRef.current = null;
                  void loadFeed(true);
                }}
              >
                <ArrowDownOutlined />
                <span>
                  {newPostsCount === 1
                    ? t('one_new_post')
                    : t('n_new_posts', { count: newPostsCount })}
                </span>
              </button>
            )}

            {!loading && items.length > 0 && (
              <FeedExploreStrip
                variant="compact"
                onAction={handleExploreAction}
              />
            )}
            {approvalAccessResolved && canModerateApprovals && (
              <section className="feed-approvals mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-base font-semibold text-[var(--ant-color-text)] m-0">{t('pending_approvals')}</h2>
                  {approvalQueue.length > 0 ? (
                    <Tag color="gold" className="m-0 border-0">
                      {approvalQueue.length}
                    </Tag>
                  ) : null}
                </div>

                {loadingApprovals && (
                  <div className="feed-approvals-empty">{t('loading_approval_queue')}</div>
                )}

                {!loadingApprovals && approvalQueue.length === 0 && (
                  <div className="feed-approvals-empty">{t('no_pending_publications')}</div>
                )}

                {!loadingApprovals && approvalQueue.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {approvalQueue.map((entry) => {
                      const pending = approvalPending[entry.id] || { approving: false, rejecting: false };
                      const submittedText = formatTimeAgo(entry.submittedAt);
                      const visibilityLabel = entry.visibility.charAt(0).toUpperCase() + entry.visibility.slice(1);
                      return (
                        <div
                          key={`approval-${entry.id}`}
                          className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-warning-border)] rounded-xl shadow-sm overflow-hidden flex flex-col relative group"
                        >
                          <div className="absolute top-0 left-0 w-1 h-full bg-[var(--ant-color-warning)]"></div>
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
                                className="font-medium h-9 px-5 rounded-md hover:bg-[var(--ant-color-border-secondary)] transition-colors"
                                loading={Boolean(pending.rejecting)}
                                disabled={Boolean(pending.approving)}
                                onClick={() => openRejectModal(entry.id)}
                              >
                                {t('reject')}
                              </Button>
                              <Button
                                type="primary"
                                className="bg-[var(--ant-color-primary)] hover:bg-[var(--ant-color-primary-hover)] font-medium h-9 px-5 rounded-md transition-colors shadow-sm"
                                loading={Boolean(pending.approving)}
                                disabled={Boolean(pending.rejecting)}
                                onClick={() => void handleApprovePublication(entry.id)}
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
              </section>
            )}

            {items.length === 0 && !loading && (
              <div className="feed-empty-state">
                <FeedExploreStrip
                  variant="empty"
                  onAction={handleExploreAction}
                  onDiscover={() => setDiscoveryOpen(true)}
                />
                <div className="feed-empty-state-copy">
                  <p className="feed-empty-state-title">{emptyStateTitle}</p>
                  {showContextualEmptyState ? (
                    <p className="feed-empty-state-sub">{emptyStateSubtitle}</p>
                  ) : null}
                </div>
                <div className="feed-empty-state-actions">
                  <Button
                    type="primary"
                    icon={<MessageOutlined />}
                    onClick={() =>
                      router.push(getChatHref({ prompt: t('explore_prompt_question') }))
                    }
                  >
                    {t('empty_cta_explore_ai')}
                  </Button>
                  <Button icon={<DashboardOutlined />} onClick={() => router.push('/dashboards')}>
                    {t('build_dashboard')}
                  </Button>
                  {!user ? (
                    <Button icon={<UserAddOutlined />} onClick={() => router.push('/login')}>
                      {t('sign_in_to_save')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-4 pb-16">
              {items.map((item, idx) => (
                <FeedCard
                  key={item.id}
                  item={item}
                  highlighted={resolvedHighlightId === item.id || focusedPostIndex === idx}
                  onReact={handleReact}
                  onSave={handleSave}
                  onAddComment={handleAddComment}
                  onToggleFollow={handleToggleFollow}
                  onDeleteItem={handleDeleteItem}
                  onCommentDeleted={handleCommentDeleted}
                  interactionState={pendingInteractions[item.id]}
                  compact
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
              <div ref={sentinelRef} className="h-4" />
              {!hasMore && items.length > 0 && !loading && (
                <div ref={endFeedActionRef} className="feed-end-action-wrap">
                  <div className={`feed-end-action-shell ${showEndFeedAction ? 'is-visible' : ''}`}>
                    <div className="feed-end-action-divider">
                      <span className="feed-end-action-divider-line" />
                      <span>{t('end_of_feed')}</span>
                      <span className="feed-end-action-divider-line" />
                    </div>
                    <button
                      type="button"
                      disabled={refreshingFromEndAction}
                      aria-busy={refreshingFromEndAction}
                      className={`feed-end-action-button ${
                        refreshingFromEndAction ? 'is-refreshing' : ''
                      } ${showEndFeedAction && !refreshingFromEndAction && !endFeedActionInteracted ? 'feed-end-action-button--pulse' : ''}`}
                      onMouseEnter={() => setEndFeedActionInteracted(true)}
                      onFocus={() => setEndFeedActionInteracted(true)}
                      onClick={() => {
                        setEndFeedActionInteracted(true);
                        void handleScrollToTop();
                      }}
                    >
                      <span className={`feed-end-action-button-icon ${refreshingFromEndAction ? 'is-refreshing' : ''}`}>
                        <ArrowUpOutlined />
                      </span>
                      <span className="feed-end-action-button-label">
                        {refreshingFromEndAction ? t('refreshing_feed') : t('back_to_top_and_refresh')}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="w-[320px] lg:w-[380px] shrink-0 hidden md:block border-l border-[var(--ant-color-border-secondary)] pl-6 lg:pl-10 pb-16">
          <FeedSidebar
            data={sidebarData}
            loading={sidebarLoading}
            timeRange={sidebarControls.timeRange}
            contentType={sidebarControls.contentType}
            sortBy={sidebarControls.sortBy}
            onChangeTimeRange={handleSidebarTimeRangeChange}
            onChangeContentType={handleSidebarContentTypeChange}
            onChangeSortBy={handleSidebarSortChange}
            onOpenItem={(postId) => router.push(`/feed/${postId}`)}
            onLikeItem={(postId) => void handleReact(postId, 'like')}
            onSaveItem={(postId) => void handleSave(postId)}
            onTagClick={handleTagFilter}
          />
        </div>
      </div>
      </div>
      <FeedDiscoveryDrawer
        open={discoveryOpen}
        onClose={() => setDiscoveryOpen(false)}
        data={sidebarData}
        loading={sidebarLoading}
        timeRange={sidebarControls.timeRange}
        contentType={sidebarControls.contentType}
        sortBy={sidebarControls.sortBy}
        onChangeTimeRange={handleSidebarTimeRangeChange}
        onChangeContentType={handleSidebarContentTypeChange}
        onChangeSortBy={handleSidebarSortChange}
        onOpenItem={(postId) => router.push(`/feed/${postId}`)}
        onLikeItem={(postId) => void handleReact(postId, 'like')}
        onSaveItem={(postId) => void handleSave(postId)}
        onTagClick={(tag) => {
          handleTagFilter(tag);
          setDiscoveryOpen(false);
        }}
      />
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
        confirmLoading={rejectSubmitting}
        onCancel={closeRejectModal}
        onOk={() => void handleRejectPublication()}
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
          className="text-right mt-1.5"
          style={{
            color: rejectReason.length > 450 ? 'var(--ant-color-error)' : 'var(--ant-color-text-description)',
            fontSize: '12px',
          }}
        >
          {rejectReason.length}/500
        </div>
      </Modal>
    </DashboardPageShell>
  );
};

export default SocialFeedPage;
