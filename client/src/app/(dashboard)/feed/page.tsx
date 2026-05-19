'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Tag, message } from 'antd';
import {
  ArrowUpOutlined,
  BarChartOutlined,
  DashboardOutlined,
  MessageOutlined,
  StarOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import FeedFilters, { FeedFiltersValue } from './components/FeedFilters';
import FeedCard from './components/FeedCard';
import FeedSidebar from './components/FeedSidebar';
import FeedCardSkeleton from './components/FeedCardSkeleton';
import { formatTimeAgo, socialFeedService } from '@/services/socialFeedService';
import type {
  ApprovalQueueItem,
  AssetType,
  FeedFilterOptions,
  FeedItem,
  FeedSidebarData,
  LeaderboardSortBy,
  LeaderboardTimeRange,
  ReactionType,
} from '@/services/socialFeedService';
import { ApiError } from '@/utils/api';
import './styles.css';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 10;
const APPROVAL_QUEUE_PAGE_SIZE = 20;
const EMPTY_FILTER_OPTIONS: FeedFilterOptions = {
  tags: [],
  authors: [],
  assetCounts: { dashboard: 0, chart: 0, insight: 0 },
};
const EMPTY_SIDEBAR_DATA: FeedSidebarData = {
  leaderboard: [],
  topContributors: [],
  recommended: [],
  trendingTags: [],
  collections: [],
  activity: [],
};
type ItemInteractionKey = 'reacting' | 'saving' | 'commenting' | 'following' | 'deleting';
type ItemInteractionState = Record<ItemInteractionKey, boolean>;
type SidebarControls = {
  timeRange: LeaderboardTimeRange;
  contentType: AssetType | 'all';
  sortBy: LeaderboardSortBy;
};
const EMPTY_ITEM_INTERACTION_STATE: ItemInteractionState = {
  reacting: false,
  saving: false,
  commenting: false,
  following: false,
  deleting: false,
};
const FEED_SKELETON_COUNT = 4;
const FEED_SKELETON_APPEND_COUNT = 2;
const FEED_CHAT_PROMPT = 'Show me sales by region';
type ApprovalDecisionAction = 'approving' | 'rejecting';

const upsertCommentInThread = (comments: FeedItem['recentComments'], comment: FeedItem['recentComments'][number]) => {
  const parentId = comment.parentCommentId;
  if (!parentId) {
    return [comment, ...comments.filter((existing) => existing.id !== comment.id)].slice(0, 3);
  }

  const attachReply = (nodes: FeedItem['recentComments']): FeedItem['recentComments'] =>
    nodes.map((node) => {
      if (node.id === parentId) {
        const nextReplies = [...(node.replies || []).filter((reply) => reply.id !== comment.id), comment];
        return {
          ...node,
          replies: nextReplies,
          replyCount: nextReplies.length,
        };
      }
      if (!node.replies?.length) return node;
      return {
        ...node,
        replies: attachReply(node.replies),
      };
    });

  return attachReply(comments);
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const SocialFeedPage: React.FC = () => {
  const t = useTranslations('feed_page');
  const router = useRouter();
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
  const [pendingInteractions, setPendingInteractions] = useState<Record<string, ItemInteractionState>>({});
  const [approvalQueue, setApprovalQueue] = useState<ApprovalQueueItem[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [canModerateApprovals, setCanModerateApprovals] = useState(false);
  const [approvalAccessResolved, setApprovalAccessResolved] = useState(false);
  const [approvalPending, setApprovalPending] = useState<Record<string, Record<ApprovalDecisionAction, boolean>>>({});
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const [filters, setFilters] = useState<FeedFiltersValue>({
    scope: 'organization',
    assetType: 'all',
    sort: 'recommended',
    tags: [],
    search: '',
  });

  const itemsRef = useRef<FeedItem[]>([]);
  const loadingRef = useRef(false);
  const reactingItemsRef = useRef<Set<string>>(new Set());
  const savingItemsRef = useRef<Set<string>>(new Set());
  const commentingItemsRef = useRef<Set<string>>(new Set());
  const followingAuthorsRef = useRef<Set<string>>(new Set());
  const deletingItemsRef = useRef<Set<string>>(new Set());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const endFeedActionRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [stickyOffset, setStickyOffset] = useState(96);
  const [showEndFeedAction, setShowEndFeedAction] = useState(false);
  const [refreshingFromEndAction, setRefreshingFromEndAction] = useState(false);
  const [endFeedActionInteracted, setEndFeedActionInteracted] = useState(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === 'undefined') return;

    const updateOffset = () => {
      setStickyOffset(toolbar.offsetHeight);
    };

    updateOffset();

    const observer = new ResizeObserver(() => updateOffset());
    observer.observe(toolbar);

    window.addEventListener('resize', updateOffset);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOffset);
    };
  }, []);

  const wrapperStyle = useMemo(
    () =>
      ({
        ['--feed-sticky-offset' as const]: `${Math.max(84, stickyOffset + 6)}px`,
      }) as React.CSSProperties,
    [stickyOffset]
  );

  const scrollFeedToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    wrapperRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
    document.documentElement?.scrollTo?.({ top: 0, behavior });
    document.body?.scrollTo?.({ top: 0, behavior });
  }, []);

  const handleFiltersChange = useCallback((next: FeedFiltersValue) => {
    setFilters(next);
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
  }, [filters.scope, sidebarControls.contentType, sidebarControls.sortBy, sidebarControls.timeRange]);

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

  const updateItem = useCallback((itemId: string, updater: (item: FeedItem) => FeedItem) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === itemId ? updater(item) : item));
      itemsRef.current = next;
      return next;
    });
  }, []);
  const updateItemsByAuthor = useCallback((authorId: string, updater: (item: FeedItem) => FeedItem) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.author?.id === authorId ? updater(item) : item));
      itemsRef.current = next;
      return next;
    });
  }, []);

  const handleCommentDeleted = useCallback(
    (itemId: string, commentCount: number) => {
      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, comments: Math.max(0, commentCount) },
      }));
    },
    [updateItem]
  );
  const setInteractionPending = useCallback((itemId: string, key: ItemInteractionKey, value: boolean) => {
    setPendingInteractions((prev) => {
      const current = prev[itemId] || EMPTY_ITEM_INTERACTION_STATE;
      const next: ItemInteractionState = { ...current, [key]: value };
      if (!next.reacting && !next.saving && !next.commenting && !next.following && !next.deleting) {
        const rest = { ...prev };
        delete rest[itemId];
        return rest;
      }
      return { ...prev, [itemId]: next };
    });
  }, []);
  const setAuthorInteractionPending = useCallback((authorId: string, value: boolean) => {
    const itemIds = itemsRef.current.filter((item) => item.author?.id === authorId).map((item) => item.id);
    if (itemIds.length === 0) return;
    setPendingInteractions((prev) => {
      const next = { ...prev };
      itemIds.forEach((itemId) => {
        const current = next[itemId] || EMPTY_ITEM_INTERACTION_STATE;
        const updated: ItemInteractionState = { ...current, following: value };
        if (!updated.reacting && !updated.saving && !updated.commenting && !updated.following && !updated.deleting) {
          delete next[itemId];
          return;
        }
        next[itemId] = updated;
      });
      return next;
    });
  }, []);

  const handleReact = async (itemId: string, reaction: ReactionType) => {
    if (reactingItemsRef.current.has(itemId)) return;
    const existingItem = itemsRef.current.find((item) => item.id === itemId);

    reactingItemsRef.current.add(itemId);
    if (existingItem) {
      setInteractionPending(itemId, 'reacting', true);
      const previousReaction = existingItem.userInteraction.reaction;
      const previousCount = existingItem.metrics.reactions;
      const optimisticReaction = previousReaction === reaction ? undefined : reaction;
      const optimisticDelta = previousReaction ? (optimisticReaction ? 0 : -1) : 1;

      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, reactions: Math.max(0, previousCount + optimisticDelta) },
        userInteraction: { ...item.userInteraction, reaction: optimisticReaction },
      }));
    }

    try {
      const response = await socialFeedService.reactToItem(itemId, reaction);
      if (existingItem) {
        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, reactions: Math.max(0, response.reaction_count) },
          userInteraction: { ...item.userInteraction, reaction: response.reaction },
        }));
      }
      await loadSidebar();
    } catch (error) {
      if (existingItem) {
        const previousReaction = existingItem.userInteraction.reaction;
        const previousCount = existingItem.metrics.reactions;
        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, reactions: Math.max(0, previousCount) },
          userInteraction: { ...item.userInteraction, reaction: previousReaction },
        }));
      }
      message.error(errorMessage(error, 'Unable to update reaction'));
    } finally {
      reactingItemsRef.current.delete(itemId);
      if (existingItem) {
        setInteractionPending(itemId, 'reacting', false);
      }
    }
  };

  const handleSave = async (itemId: string) => {
    if (savingItemsRef.current.has(itemId)) return;
    const existingItem = itemsRef.current.find((item) => item.id === itemId);
    savingItemsRef.current.add(itemId);
    if (existingItem) {
      setInteractionPending(itemId, 'saving', true);
      const previousBookmarked = existingItem.userInteraction.isBookmarked;
      const previousCount = existingItem.metrics.bookmarks;
      const optimisticBookmarked = !previousBookmarked;
      const optimisticCount = Math.max(0, previousCount + (optimisticBookmarked ? 1 : -1));

      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, bookmarks: optimisticCount },
        userInteraction: { ...item.userInteraction, isBookmarked: optimisticBookmarked },
      }));
    }

    try {
      const response = await socialFeedService.toggleBookmark(itemId);
      if (existingItem) {
        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, bookmarks: Math.max(0, response.bookmark_count) },
          userInteraction: { ...item.userInteraction, isBookmarked: response.isBookmarked },
        }));
      }
      await loadSidebar();

      if (response.isBookmarked) {
        message.success(t('saved_for_review'));
      } else {
        message.info(t('removed_from_saved'));
      }
    } catch (error) {
      if (existingItem) {
        const previousBookmarked = existingItem.userInteraction.isBookmarked;
        const previousCount = existingItem.metrics.bookmarks;
        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, bookmarks: Math.max(0, previousCount) },
          userInteraction: { ...item.userInteraction, isBookmarked: previousBookmarked },
        }));
      }
      message.error(errorMessage(error, t('unable_update_saved')));
    } finally {
      savingItemsRef.current.delete(itemId);
      if (existingItem) {
        setInteractionPending(itemId, 'saving', false);
      }
    }
  };

  const handleAddComment = async (itemId: string, content: string, parentCommentId?: string) => {
    if (commentingItemsRef.current.has(itemId)) return;
    const existingItem = itemsRef.current.find((item) => item.id === itemId);
    if (!existingItem) return;

    commentingItemsRef.current.add(itemId);
    setInteractionPending(itemId, 'commenting', true);

    const previousCount = existingItem.metrics.comments;
    const previousLastActivity = existingItem.lastActivityAt;
    const previousRecentComments = existingItem.recentComments;
    const optimisticTimestamp = new Date().toISOString();

    updateItem(itemId, (item) => ({
      ...item,
      lastActivityAt: optimisticTimestamp,
      metrics: { ...item.metrics, comments: Math.max(0, previousCount + 1) },
    }));

    try {
      const response = await socialFeedService.addComment(itemId, content, parentCommentId);
      updateItem(itemId, (item) => ({
        ...item,
        lastActivityAt: response.comment.createdAt,
        metrics: { ...item.metrics, comments: Math.max(0, response.comment_count) },
        recentComments: upsertCommentInThread(item.recentComments, response.comment),
      }));
    } catch (error) {
      updateItem(itemId, (item) => ({
        ...item,
        lastActivityAt: previousLastActivity,
        metrics: { ...item.metrics, comments: Math.max(0, previousCount) },
        recentComments: previousRecentComments,
      }));
      message.error(errorMessage(error, t('unable_add_comment')));
    } finally {
      commentingItemsRef.current.delete(itemId);
      setInteractionPending(itemId, 'commenting', false);
    }
  };
  const handleToggleFollow = async (itemId: string, authorId: string) => {
    if (followingAuthorsRef.current.has(authorId)) return;
    const targetItem = itemsRef.current.find((item) => item.id === itemId);
    if (!targetItem) return;

    const previousFollowState = new Map<string, boolean>();
    itemsRef.current.forEach((item) => {
      if (item.author?.id === authorId) {
        previousFollowState.set(item.id, Boolean(item.userInteraction?.isFollowingAuthor));
      }
    });
    if (previousFollowState.size === 0) return;

    followingAuthorsRef.current.add(authorId);
    setAuthorInteractionPending(authorId, true);

    const optimisticFollowing = !Boolean(targetItem.userInteraction?.isFollowingAuthor);
    updateItemsByAuthor(authorId, (item) => ({
      ...item,
      userInteraction: { ...item.userInteraction, isFollowingAuthor: optimisticFollowing },
    }));

    try {
      const response = await socialFeedService.toggleFollowAuthor(authorId);
      updateItemsByAuthor(authorId, (item) => ({
        ...item,
        userInteraction: { ...item.userInteraction, isFollowingAuthor: response.isFollowing },
      }));
      message.success(response.isFollowing ? t('following_author') : t('unfollowed_author'));
    } catch (error) {
      setItems((prev) => {
        const restored = prev.map((item) => {
          if (item.author?.id !== authorId) return item;
          return {
            ...item,
            userInteraction: {
              ...item.userInteraction,
              isFollowingAuthor: previousFollowState.get(item.id) || false,
            },
          };
        });
        itemsRef.current = restored;
        return restored;
      });
      message.error(errorMessage(error, t('unable_update_follow')));
    } finally {
      followingAuthorsRef.current.delete(authorId);
      setAuthorInteractionPending(authorId, false);
    }
  };
  const handleDeleteItem = async (itemId: string) => {
    if (deletingItemsRef.current.has(itemId)) return;
    if (!itemsRef.current.some((item) => item.id === itemId)) return;

    deletingItemsRef.current.add(itemId);
    setInteractionPending(itemId, 'deleting', true);

    const previousItems = itemsRef.current;
    const nextItems = previousItems.filter((item) => item.id !== itemId);
    itemsRef.current = nextItems;
    setItems(nextItems);

    try {
      await socialFeedService.deleteItem(itemId);
      message.success(t('post_deleted'));
    } catch (error) {
      itemsRef.current = previousItems;
      setItems(previousItems);
      message.error(errorMessage(error, t('unable_delete_post')));
    } finally {
      deletingItemsRef.current.delete(itemId);
      setInteractionPending(itemId, 'deleting', false);
    }
  };

  const handleApprovePublication = useCallback(
    async (queueItemId: string) => {
      if (approvalPending[queueItemId]?.approving) return;
      setApprovalPendingState(queueItemId, 'approving', true);
      try {
        await socialFeedService.approvePublication(queueItemId);
        removeApprovalQueueItem(queueItemId);
        message.success(t('publication_approved'));
      } catch (error) {
        message.error(errorMessage(error, t('unable_approve_publication')));
      } finally {
        setApprovalPendingState(queueItemId, 'approving', false);
      }
    },
    [approvalPending, removeApprovalQueueItem, setApprovalPendingState]
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

  const searchQuery = (filters.search || '').trim();
  const hasSearchFilter = searchQuery.length > 0;
  const hasTagFilters = filters.tags.length > 0;
  const hasAssetFilter = filters.assetType !== 'all';
  const hasScopeFilter = filters.scope !== 'organization';
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
        return 'dashboard posts';
      case 'chart':
        return 'chart posts';
      case 'insight':
        return 'insight posts';
      case 'all':
      default:
        return 'posts';
    }
  }, [filters.assetType]);

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
    <div
      ref={wrapperRef}
      className="flex flex-col h-full bg-[var(--layout-background)] overflow-y-auto"
      style={wrapperStyle}
    >
      <div className="px-6 lg:px-10 pt-8 pb-4 bg-[var(--layout-background)] sticky top-0 z-40">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ant-color-text)] mb-1.5">{t('social_analytics_feed')}</h1>
            <p className="text-[var(--ant-color-text-secondary)] text-sm">
              {t('explore_live_insights')}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="primary"
              className="h-10 px-5 rounded-md font-medium text-sm shadow-sm"
              icon={<MessageOutlined />}
              onClick={() => router.push(`/chat?prompt=${encodeURIComponent(FEED_CHAT_PROMPT)}`)}
            >
              {t('ask_ai')}
            </Button>
            <Button
              className="h-10 px-5 rounded-md font-medium text-sm text-[var(--ant-color-text)] bg-[var(--ant-color-bg-container)] border-[var(--ant-color-border)] hover:bg-[var(--ant-color-bg-layout)] shadow-sm"
              icon={<DashboardOutlined />}
              onClick={() => router.push('/dashboards')}
            >
              {t('my_dashboards')}
            </Button>
            <Button
              className="h-10 px-5 rounded-md font-medium text-sm text-[var(--ant-color-text)] bg-[var(--ant-color-bg-container)] border-[var(--ant-color-border)] hover:bg-[var(--ant-color-bg-layout)] shadow-sm"
              icon={<StarOutlined />}
              onClick={() => router.push('/feed/saved')}
            >
              {t('saved')}
            </Button>
          </div>
        </div>
        <div ref={toolbarRef} className="w-full">
          <FeedFilters value={filters} options={filterOptions} onChange={handleFiltersChange} />
        </div>
      </div>

      <div className="flex flex-1 max-w-[1600px] w-full mx-auto pb-10 relative">
        <div className="flex-1 min-w-0 px-6 lg:px-10 pt-2 flex flex-col items-center">
          <div className="w-full max-w-3xl">
            {approvalAccessResolved && canModerateApprovals && (
              <section className="mb-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-[var(--ant-color-text)] tracking-tight">{t('pending_approvals')}</h2>
                    <Tag color="gold" className="m-0 border-0">
                      {approvalQueue.length}
                    </Tag>
                  </div>
                  <span className="text-sm text-[var(--ant-color-text-secondary)] font-medium">
                    {t('approve_or_reject_submissions')}
                  </span>
                </div>

                {loadingApprovals && (
                  <div className="p-8 text-center text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] rounded-xl shadow-sm">
                    {t('loading_approval_queue')}
                  </div>
                )}

                {!loadingApprovals && approvalQueue.length === 0 && (
                  <div className="p-8 text-center text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-bg-layout)] border border-dashed border-[var(--ant-color-border)] rounded-xl">
                    {t('no_pending_publications')}
                  </div>
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
              <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-xl shadow-sm my-6">
                <div className="w-16 h-16 rounded-full bg-[var(--ant-color-primary-bg)] flex items-center justify-center mb-6">
                  <DashboardOutlined className="text-2xl text-[var(--ant-color-primary)]" />
                </div>
                <h2 className="text-xl font-bold text-[var(--ant-color-text)] mb-2">{emptyStateTitle}</h2>
                <p className="text-[var(--ant-color-text-secondary)] mb-8 max-w-md">{emptyStateSubtitle}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl text-left">
                  <button
                    type="button"
                    className="flex items-start gap-4 p-5 rounded-xl border border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary)] hover:shadow-md transition-all text-left group bg-[var(--ant-color-bg-container)]"
                    onClick={() => router.push('/dashboards')}
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <BarChartOutlined className="text-xl" />
                    </div>
                    <div>
                      <span className="block font-semibold text-[var(--ant-color-text)] mb-1">{t('build_dashboard')}</span>
                      <span className="block text-sm text-[var(--ant-color-text-secondary)] leading-relaxed">
                        {t('build_dashboard_desc')}
                      </span>
                    </div>
                  </button>
                  {!user && (
                    <button
                      type="button"
                      className="flex items-start gap-4 p-5 rounded-xl border border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary)] hover:shadow-md transition-all text-left group bg-[var(--ant-color-bg-container)]"
                      onClick={() => router.push('/login')}
                    >
                      <div className="w-10 h-10 rounded-lg bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                        <UserAddOutlined className="text-xl" />
                      </div>
                      <div>
                        <span className="block font-semibold text-[var(--ant-color-text)] mb-1">{t('sign_in_to_save')}</span>
                        <span className="block text-sm text-[var(--ant-color-text-secondary)] leading-relaxed">
                          {t('sign_in_to_save_desc')}
                        </span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-6 pb-20">
              {items.map((item) => (
                <FeedCard
                  key={item.id}
                  item={item}
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
          />
        </div>
      </div>
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
    </div>
  );
};

export default SocialFeedPage;
