'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Compass,
  Flame,
  Info,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  MessageCircleMore,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/aicser-ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Textarea } from '@/components/aicser-ui/textarea';
import { cn } from '@/lib/ui/utils';
import { message } from '@/lib/ui/toast';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';

/** Feed publication moderation queue — hidden until re-enabled. */
const SHOW_FEED_APPROVALS_UI = false;

import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useFeedFiltersStore } from '@/stores/useFeedFiltersStore';
import { useProjectStore } from '@/stores/useProjectStore';
import FeedFilters from './components/FeedFilters';
import FeedCard from './components/FeedCard';
import FeedGridCard from './components/FeedGridCard';
import SoftCollapsedFeedPost from './components/SoftCollapsedFeedPost';
import { isInsightFeedItem, isNoiseTextPost, isTextPostItem } from '@/components/Feed/feedPostDisplay';
import FeedCardSkeleton from './components/FeedCardSkeleton';
import FeedDiscoveryDrawer from '@/components/Feed/FeedDiscoveryDrawer';
import NewPostComposer from '@/components/Feed/NewPostComposer';
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
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const queryPostId = searchParams?.get('post') || '';
  const highlightPostId = useMemo(() => resolveFeedHighlightPostId(queryPostId), [queryPostId]);
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const activeOrganizationId =
    currentProject?.organization_id || (currentProject as { organizationId?: string } | null)?.organizationId;
  const activeProjectId = currentProject?.id != null ? String(currentProject.id) : undefined;

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
      // Without these, 'organization'/'project' scope silently falls back
      // (server-side) to "every org/project I belong to" instead of the one
      // active in the header — switching projects there had no effect on
      // the "My Project" feed filter at all.
      organizationId: activeOrganizationId ? String(activeOrganizationId) : undefined,
      projectId: activeProjectId,
      privateProjectOnly: filters.privateProjectOnly,
    }),
    [
      debouncedSearch,
      filters.assetType,
      filters.scope,
      filters.sort,
      filters.tags,
      filters.privateProjectOnly,
      activeOrganizationId,
      activeProjectId,
    ]
  );

  // ─── Server data (React Query) ────────────────────────────────────────────
  const feedQuery = useFeedListQuery(requestFilters);
  const { items } = feedQuery;
  const loading = feedQuery.isLoading || feedQuery.isFetchingNextPage;

  const filterOptionsQuery = useFeedFilterOptionsQuery(filters.scope, {
    organizationId: activeOrganizationId ? String(activeOrganizationId) : undefined,
    projectId: activeProjectId,
    privateProjectOnly: filters.privateProjectOnly,
  });
  const filterOptions = filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS;

  const sidebarQuery = useFeedSidebarQuery(filters.scope, sidebarControls, {
    organizationId: activeOrganizationId ? String(activeOrganizationId) : undefined,
    projectId: activeProjectId,
    privateProjectOnly: filters.privateProjectOnly,
  });
  const sidebarData = sidebarQuery.data ?? EMPTY_SIDEBAR_DATA;

  const refreshSidebar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: feedKeys.sidebar(filters.scope, sidebarControls) });
  }, [filters.scope, queryClient, sidebarControls]);

  const {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleCommentDeleted,
    handleToggleFollow,
    handleDeleteItem,
    handleUpdatePost,
  } = useFeedInteractions(items, useFeedItemsCacheSetter(requestFilters), { onSidebarRefresh: refreshSidebar });

  const {
    approvalQueue,
    canModerateApprovals,
    accessResolved: approvalAccessResolved,
    isLoading: loadingApprovals,
  } = useApprovalQueueQuery({ enabled: SHOW_FEED_APPROVALS_UI });
  const approveMutation = useApprovePublicationMutation();
  const rejectMutation = useRejectPublicationMutation();

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [streamView, setStreamView] = useState<'all' | 'insights' | 'discussions'>('all');

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

  const handleNewPost = useCallback(
    async (postId: string) => {
      const item = await socialFeedService.getItemById(postId).catch(() => null);
      if (item) prependFeedItem(item);
    },
    [prependFeedItem]
  );

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
          organizationId: activeOrganizationId ? String(activeOrganizationId) : undefined,
          projectId: activeProjectId,
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
  }, [filters.scope, activeOrganizationId, activeProjectId]);

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

  const visibleItems = useMemo(() => {
    if (streamView === 'insights') return items.filter((item) => isInsightFeedItem(item));
    if (streamView === 'discussions') return items.filter((item) => isTextPostItem(item) && !isInsightFeedItem(item));
    return items;
  }, [items, streamView]);

  const exploreActions: { key: string; icon: React.ReactNode; label: string; run: () => void }[] = [
    { key: 'discover', icon: <Compass />, label: t('discover'), run: () => setDiscoveryOpen(true) },
    {
      key: 'trending',
      icon: <Flame />,
      label: t('explore_chip_trending'),
      run: () => setFilters({ ...filters, sort: 'trending', scope: defaultScope }),
    },
    {
      key: 'team',
      icon: <Users />,
      label: t('explore_chip_team'),
      run: () => setFilters({ ...filters, scope: defaultScope, sort: 'recommended' }),
    },
    {
      key: 'learn',
      icon: <Lightbulb />,
      label: t('explore_chip_learn'),
      run: () => router.push(getChatHref({ prompt: t('explore_prompt_learn') })),
    },
    {
      key: 'build_dashboard',
      icon: <LayoutDashboard />,
      label: t('build_dashboard'),
      run: () => router.push('/dashboards'),
    },
    { key: 'share', icon: <Share2 />, label: t('explore_chip_share_insight'), run: () => router.push('/feed/publish') },
  ];

  return (
    <div
      ref={wrapperRef}
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden bg-background px-4 text-foreground sm:px-6"
    >
      {/* Toolbar: stays in view while the posts scroll under it. */}
      <div className="sticky top-0 z-30 -mx-4 bg-background/95 px-4 pb-3 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <FeedFilters
            value={filters}
            options={filterOptions}
            onChange={setFilters}
            streamView={streamView}
            onStreamViewChange={setStreamView}
          />
          {highlightPostId && !resolvedHighlightId ? (
            <p
              role="status"
              className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
            >
              <Info className="size-4 shrink-0" aria-hidden />
              {t('finding_post')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 pb-10 pt-1">
        <NewPostComposer
          onPosted={handleNewPost}
          feedScope={filters.scope}
          onAudienceChange={(scope) => setFilters({ ...filters, scope })}
        />

        {newPostsCount > 0 && !loading ? (
          <div className="flex justify-center">
            <Button
              className="rounded-full px-4 shadow-sm"
              onClick={() => {
                setNewPostsCount(0);
                latestItemIdRef.current = null;
                void resetFeedToFirstPage();
              }}
            >
              <ArrowDown />
              {newPostsCount === 1 ? t('one_new_post') : t('n_new_posts', { count: newPostsCount })}
            </Button>
          </div>
        ) : null}

        {SHOW_FEED_APPROVALS_UI && approvalAccessResolved && canModerateApprovals ? (
          <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label={t('pending_approvals')}>
            <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
              {t('pending_approvals')}
              {approvalQueue.length > 0 ? <Badge variant="warning">{approvalQueue.length}</Badge> : null}
            </h2>
            {loadingApprovals ? (
              <p className="m-0 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t('loading_approval_queue')}
              </p>
            ) : approvalQueue.length === 0 ? (
              <p className="m-0 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t('no_pending_publications')}
              </p>
            ) : (
              approvalQueue.map((entry) => {
                const isApproving = approveMutation.isPending && approveMutation.variables === entry.id;
                const isRejecting = rejectMutation.isPending && rejectMutation.variables?.queueItemId === entry.id;
                const submittedText = formatTimeAgo(entry.submittedAt);
                const visibilityLabel = entry.visibility.charAt(0).toUpperCase() + entry.visibility.slice(1);
                return (
                  <div
                    key={`approval-${entry.id}`}
                    className="overflow-hidden rounded-xl border border-l-4 border-l-amber-400"
                  >
                    <FeedCard item={entry.item} compact hideInteractions />
                    <div className="flex flex-col items-center justify-between gap-3 border-t bg-muted/50 p-3 sm:flex-row">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{t('submitted_time', { submittedText })}</span>
                        <Badge variant="outline">{visibilityLabel}</Badge>
                        {entry.possiblePersonalData ? (
                          <span className="text-amber-700 dark:text-amber-300">{t('possible_personal_data')}</span>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          disabled={isApproving || isRejecting}
                          onClick={() => openRejectModal(entry.id)}
                        >
                          {isRejecting ? <Loader2 className="animate-spin" /> : null}
                          {t('reject')}
                        </Button>
                        <Button
                          disabled={isApproving || isRejecting}
                          onClick={() => handleApprovePublication(entry.id)}
                        >
                          {isApproving ? <Loader2 className="animate-spin" /> : null}
                          {t('approve')}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        ) : null}

        {visibleItems.length === 0 && !loading ? (
          <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center">
            <h3 className="m-0 text-base font-semibold">
              {streamView !== 'all' && items.length > 0
                ? streamView === 'insights'
                  ? t('empty_title_stream_insights')
                  : t('empty_title_stream_discussions')
                : emptyStateTitle}
            </h3>
            <p className="m-0 max-w-md text-sm text-muted-foreground">
              {streamView !== 'all' && items.length > 0 ? t('empty_sub_stream_switch') : emptyStateSubtitle}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => router.push(getChatHref({ prompt: t('explore_prompt_question') }))}>
                <MessageCircleMore />
                {t('empty_cta_explore_ai')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    {t('explore_more')}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {exploreActions.map((action) => (
                    <DropdownMenuItem key={action.key} onSelect={action.run}>
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {!user ? (
              <Button variant="link" onClick={() => router.push('/login')}>
                <UserPlus />
                {t('sign_in_to_save')}
              </Button>
            ) : null}
          </section>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2" role="feed" aria-busy={loading}>
          {visibleItems.map((item) => {
            const highlighted =
              resolvedHighlightId === item.id || (focusedPostIndex >= 0 && items[focusedPostIndex]?.id === item.id);
            if (isTextPostItem(item)) {
              const card = (
                <FeedCard
                  item={item}
                  compact
                  highlighted={highlighted}
                  onReact={handleReact}
                  onSave={handleSave}
                  onAddComment={handleAddComment}
                  onToggleFollow={handleToggleFollow}
                  onDeleteItem={handleDeleteItem}
                  onUpdatePost={handleUpdatePost}
                  onCommentDeleted={handleCommentDeleted}
                  interactionState={pendingInteractions[item.id]}
                />
              );
              return (
                <div key={item.id} className="col-span-full">
                  {isNoiseTextPost(item) ? <SoftCollapsedFeedPost item={item}>{card}</SoftCollapsedFeedPost> : card}
                </div>
              );
            }
            return (
              <FeedGridCard
                key={item.id}
                item={item}
                highlighted={highlighted}
                onReact={handleReact}
                onSave={handleSave}
                onToggleFollow={handleToggleFollow}
                onDeleteItem={handleDeleteItem}
                interactionState={pendingInteractions[item.id]}
              />
            );
          })}
          {loading
            ? Array.from({ length: visibleItems.length === 0 ? FEED_SKELETON_COUNT : FEED_SKELETON_APPEND_COUNT }).map(
                (_, index) => (
                  <FeedCardSkeleton
                    key={`feed-skeleton-${visibleItems.length === 0 ? 'initial' : 'append'}-${index}`}
                    compact
                  />
                )
              )
            : null}
          <div ref={sentinelRef} className="col-span-full h-4" />
          {!feedQuery.hasNextPage && visibleItems.length > 0 && !loading ? (
            <div
              ref={endFeedActionRef}
              className={cn(
                'col-span-full flex flex-col items-center gap-4 py-8 transition-all duration-300',
                showEndFeedAction ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
              )}
            >
              <div className="flex w-full max-w-xs items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>{t('end_of_feed')}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                variant="outline"
                className={cn(
                  'rounded-full px-5',
                  showEndFeedAction && !refreshingFromEndAction && !endFeedActionInteracted && 'animate-pulse'
                )}
                disabled={refreshingFromEndAction}
                onMouseEnter={() => setEndFeedActionInteracted(true)}
                onFocus={() => setEndFeedActionInteracted(true)}
                onClick={() => {
                  setEndFeedActionInteracted(true);
                  void handleScrollToTop();
                }}
              >
                {refreshingFromEndAction ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                {refreshingFromEndAction ? t('refreshing_feed') : t('back_to_top_and_refresh')}
              </Button>
            </div>
          ) : null}
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
        <Dialog open={Boolean(rejectTargetId)} onOpenChange={(open) => !open && closeRejectModal()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('reject_publication')}</DialogTitle>
            </DialogHeader>
            <label htmlFor="feed-reject-reason" className="text-sm font-medium">
              {t('reason_for_rejection')}
            </label>
            <Textarea
              id="feed-reject-reason"
              rows={3}
              value={rejectReason}
              maxLength={500}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={t('reason_rejection_placeholder')}
            />
            <p
              className={cn(
                'm-0 text-right text-xs',
                rejectReason.length > 450 ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {rejectReason.length}/500
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={closeRejectModal} disabled={rejectMutation.isPending}>
                {tCommon('cancel')}
              </Button>
              <Button variant="destructive" onClick={handleRejectPublication} disabled={rejectMutation.isPending}>
                {rejectMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                {t('reject')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
};

export default SocialFeedPage;
