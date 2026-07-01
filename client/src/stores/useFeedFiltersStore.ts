import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AssetType, FeedScope, LeaderboardSortBy, LeaderboardTimeRange } from '@/services/socialFeedService';
import { isEnterpriseEdition } from '@/utils/appPaths';
import type { FeedFiltersValue } from '@/app/(dashboard)/feed/components/FeedFilters';

export type { FeedFiltersValue };

export interface FeedSidebarControls {
  timeRange: LeaderboardTimeRange;
  contentType: AssetType | 'all';
  sortBy: LeaderboardSortBy;
}

interface FeedFiltersState {
  filters: FeedFiltersValue;
  sidebarControls: FeedSidebarControls;
  setFilters: (next: FeedFiltersValue) => void;
  addTagFilter: (tag: string) => void;
  setSidebarTimeRange: (value: LeaderboardTimeRange) => void;
  setSidebarContentType: (value: AssetType | 'all') => void;
  setSidebarSortBy: (value: LeaderboardSortBy) => void;
}

const defaultScope: FeedScope = isEnterpriseEdition() ? 'organization' : 'public';

/** Shared UI/selection state for the Feed page — read by FeedFilters, FeedSidebar,
 *  FeedDiscoveryDrawer, and FeedExploreStrip, which would otherwise need heavy prop drilling. */
export const useFeedFiltersStore = create<FeedFiltersState>()(
  devtools(
    (set) => ({
      filters: {
        scope: defaultScope,
        assetType: 'all',
        sort: 'recommended',
        tags: [],
        search: '',
      },
      sidebarControls: {
        timeRange: 'week',
        contentType: 'all',
        sortBy: 'popular',
      },
      setFilters: (next) => set({ filters: next }, false, 'feedFilters/setFilters'),
      addTagFilter: (tag) =>
        set(
          (state) => ({
            filters: state.filters.tags.includes(tag)
              ? state.filters
              : { ...state.filters, tags: [...state.filters.tags, tag] },
          }),
          false,
          'feedFilters/addTagFilter'
        ),
      setSidebarTimeRange: (value) =>
        set((state) => ({ sidebarControls: { ...state.sidebarControls, timeRange: value } }), false, 'feedFilters/setSidebarTimeRange'),
      setSidebarContentType: (value) =>
        set((state) => ({ sidebarControls: { ...state.sidebarControls, contentType: value } }), false, 'feedFilters/setSidebarContentType'),
      setSidebarSortBy: (value) =>
        set((state) => ({ sidebarControls: { ...state.sidebarControls, sortBy: value } }), false, 'feedFilters/setSidebarSortBy'),
    }),
    { name: 'feed-filters' }
  )
);
