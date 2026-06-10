'use client';

import { useCallback, useMemo } from 'react';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useDashboardCrossFilter } from './useDashboardCrossFilter';
import { mergeFilterConfigs } from '../utils/filterConfigMerge';
import { filterVisibleLayout, filterVisibleWidgets } from '../utils/dashboardViewerScope';
import type { DashboardPageItem } from '../components/DashboardPageTabs';

type PageScope = {
  pages: DashboardPageItem[];
  activePageId: string | null;
  defaultPageId: string | null;
};

/**
 * Studio view/fullscreen: read path aligned with shared viewer refresh semantics
 * while widgets/layout stay in the editor store (no duplicate load).
 */
export function useStudioDashboardView(pageScope: PageScope) {
  const widgets = useDashboardStore((s) => s.widgets);
  const layout = useDashboardStore((s) => s.layout);
  const runtimeFilters = useDashboardStore((s) => s.runtimeFilters);
  const setRuntimeFilters = useDashboardStore((s) => s.setRuntimeFilters);
  const globalFiltersConfig = useDashboardStore((s) => s.globalFiltersConfig);
  const pageFiltersConfig = useDashboardStore((s) => s.pageFiltersConfig);
  const refreshAllChartData = useDashboardStore((s) => s.refreshAllChartData);
  const handleCrossFilter = useDashboardCrossFilter(runtimeFilters, setRuntimeFilters);

  const { pages, activePageId, defaultPageId } = pageScope;

  const visibleWidgets = useMemo(
    () => filterVisibleWidgets(widgets, layout, activePageId, pages, defaultPageId),
    [widgets, layout, activePageId, pages, defaultPageId],
  );

  const visibleLayout = useMemo(
    () => filterVisibleLayout(layout, visibleWidgets),
    [layout, visibleWidgets],
  );

  const combinedFiltersConfig = useMemo(
    () => mergeFilterConfigs(globalFiltersConfig, pageFiltersConfig, { markPageAsNonGlobal: true }),
    [globalFiltersConfig, pageFiltersConfig],
  );

  const handleRetryWidget = useCallback(
    (widgetId: string) => {
      void refreshAllChartData([widgetId]);
    },
    [refreshAllChartData],
  );

  return {
    visibleWidgets,
    visibleLayout,
    runtimeFilters,
    setRuntimeFilters,
    handleCrossFilter,
    handleRetryWidget,
    combinedFiltersConfig,
  };
}

export default useStudioDashboardView;
