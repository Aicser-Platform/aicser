'use client';

import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/utils/api';
import { socialFeedService } from '@/services/socialFeedService';
import type {
  ApprovalQueueItem,
  AssetType,
  FeedFilterOptions,
  FeedItem,
  FeedScope,
  FeedSidebarData,
  FeedSort,
  LeaderboardSortBy,
  LeaderboardTimeRange,
} from '@/services/socialFeedService';

const PAGE_SIZE = 10;
const APPROVAL_QUEUE_PAGE_SIZE = 20;

export const EMPTY_FILTER_OPTIONS: FeedFilterOptions = {
  tags: [],
  authors: [],
  assetCounts: { dashboard: 0, chart: 0, insight: 0, query: 0 },
};

export const EMPTY_SIDEBAR_DATA: FeedSidebarData = {
  leaderboard: [],
  topContributors: [],
  recommended: [],
  trendingTags: [],
  collections: [],
  activity: [],
};

export interface FeedRequestFilters {
  scope: FeedScope;
  assetType: AssetType | 'all';
  sort: FeedSort;
  tags: string[];
  search: string;
}

export interface SidebarControls {
  timeRange: LeaderboardTimeRange;
  contentType: AssetType | 'all';
  sortBy: LeaderboardSortBy;
}

export const feedKeys = {
  list: (filters: FeedRequestFilters) => ['feed', 'list', filters] as const,
  filterOptions: (scope: string) => ['feed', 'filter-options', scope] as const,
  sidebar: (scope: string, controls: SidebarControls) => ['feed', 'sidebar', scope, controls] as const,
  approvalQueue: ['feed', 'approval-queue'] as const,
  item: (itemId: string) => ['feed', 'item', itemId] as const,
};

interface FeedPage {
  items: FeedItem[];
  /** Offset this page was fetched at — fixed at fetch time, never derived from the (possibly later-mutated) items array. */
  offset: number;
  /** Offset the NEXT page should request — also fixed at fetch time, so optimistic edits to `items` (delete/insert) never corrupt pagination. */
  nextOffset: number | undefined;
}

/** Infinite-scroll feed list. Replaces manual offset/hasMore bookkeeping with React Query. */
export function useFeedListQuery(filters: FeedRequestFilters) {
  const query = useInfiniteQuery({
    queryKey: feedKeys.list(filters),
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const response = await socialFeedService.getFeed({
        scope: filters.scope,
        sort: filters.sort,
        tags: filters.tags,
        search: filters.search.trim() || undefined,
        assetType: filters.assetType === 'all' ? undefined : filters.assetType,
        limit: PAGE_SIZE,
        offset: pageParam,
      });
      const items = response.items ?? [];
      const nextOffset = pageParam + items.length;
      const hasValidTotal = typeof response.total === 'number' && Number.isFinite(response.total);
      const hasMoreByTotal = hasValidTotal ? nextOffset < response.total : true;
      const hasMoreByPage = items.length >= PAGE_SIZE;
      return { items, offset: pageParam, nextOffset: hasMoreByTotal && hasMoreByPage ? nextOffset : undefined };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return { ...query, items };
}

/** Adapter so existing item-mutation hooks (e.g. useFeedInteractions) can edit the infinite-query cache
 *  through the same `setItems`-shaped interface they'd use with plain useState. */
export function useFeedItemsCacheSetter(filters: FeedRequestFilters): Dispatch<SetStateAction<FeedItem[]>> {
  const queryClient = useQueryClient();
  return useCallback(
    (updater) => {
      queryClient.setQueryData(feedKeys.list(filters), (old: { pages: FeedPage[]; pageParams: unknown[] } | undefined) => {
        if (!old) return old;
        const flatPrev = old.pages.flatMap((page) => page.items);
        const flatNext = typeof updater === 'function' ? (updater as (prev: FeedItem[]) => FeedItem[])(flatPrev) : updater;
        if (flatNext === flatPrev) return old;

        let cursor = 0;
        const nextPages = old.pages.map((page, index) => {
          const isLast = index === old.pages.length - 1;
          const size = page.items.length;
          const slice = isLast ? flatNext.slice(cursor) : flatNext.slice(cursor, cursor + size);
          cursor += size;
          return { ...page, items: slice };
        });
        return { ...old, pages: nextPages };
      });
    },
    [queryClient, filters]
  );
}

/** Prepend a fetched-by-id post to the first page of the cached list (used for the highlight/deep-link fallback). */
export function usePrependFeedItem(filters: FeedRequestFilters) {
  const setItems = useFeedItemsCacheSetter(filters);
  return useCallback(
    (post: FeedItem) => {
      setItems((prev) => (prev.some((item) => item.id === post.id) ? prev : [post, ...prev]));
    },
    [setItems]
  );
}

export function useFeedFilterOptionsQuery(scope: FeedScope) {
  return useQuery({
    queryKey: feedKeys.filterOptions(scope),
    queryFn: async (): Promise<FeedFilterOptions> => {
      const response = await socialFeedService.getFilterOptions(scope);
      return {
        tags: response.tags ?? [],
        authors: response.authors ?? [],
        assetCounts: response.assetCounts ?? { dashboard: 0, chart: 0, insight: 0, query: 0 },
      };
    },
    placeholderData: EMPTY_FILTER_OPTIONS,
  });
}

export function useFeedSidebarQuery(scope: FeedScope, controls: SidebarControls) {
  return useQuery({
    queryKey: feedKeys.sidebar(scope, controls),
    queryFn: async (): Promise<FeedSidebarData> => {
      const response = await socialFeedService.getSidebarData(scope, {
        timeRange: controls.timeRange,
        contentType: controls.contentType,
        sortBy: controls.sortBy,
        leaderboardLimit: 8,
      });
      return {
        leaderboard: response.leaderboard ?? [],
        topContributors: response.topContributors ?? [],
        recommended: response.recommended ?? [],
        trendingTags: response.trendingTags ?? [],
        collections: response.collections ?? [],
        activity: response.activity ?? [],
      };
    },
    placeholderData: EMPTY_SIDEBAR_DATA,
  });
}

interface ApprovalQueueResult {
  items: ApprovalQueueItem[];
  /** True when the current user got a 401/403 — i.e. isn't a moderator — rather than a real failure. */
  forbidden: boolean;
}

/** Moderator-only approval queue. A 401/403 means "not a moderator", not an error — modeled as data, not a query error. */
export function useApprovalQueueQuery() {
  const query = useQuery({
    queryKey: feedKeys.approvalQueue,
    queryFn: async (): Promise<ApprovalQueueResult> => {
      try {
        const response = await socialFeedService.getApprovalQueue({ limit: APPROVAL_QUEUE_PAGE_SIZE, offset: 0 });
        return { items: response.items ?? [], forbidden: false };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return { items: [], forbidden: true };
        }
        throw error;
      }
    },
    retry: false,
  });

  return {
    ...query,
    approvalQueue: query.data?.items ?? [],
    canModerateApprovals: query.isSuccess && !query.data.forbidden,
    accessResolved: query.isSuccess || query.isError,
  };
}

export function useApprovePublicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (queueItemId: string) => socialFeedService.approvePublication(queueItemId),
    onSuccess: (_response, queueItemId) => {
      queryClient.setQueryData<ApprovalQueueResult>(feedKeys.approvalQueue, (old) =>
        old ? { ...old, items: old.items.filter((entry) => entry.id !== queueItemId) } : old
      );
    },
  });
}

export function useRejectPublicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ queueItemId, reason }: { queueItemId: string; reason: string }) =>
      socialFeedService.rejectPublication(queueItemId, reason),
    onSuccess: (_response, { queueItemId }) => {
      queryClient.setQueryData<ApprovalQueueResult>(feedKeys.approvalQueue, (old) =>
        old ? { ...old, items: old.items.filter((entry) => entry.id !== queueItemId) } : old
      );
    },
  });
}
