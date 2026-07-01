'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getAffectedWidgetIds } from '../utils/affectedWidgetIds';
import { mergeFilterConfigs } from '../utils/filterConfigMerge';
import type { RuntimeFilter } from '../utils/filterOperators';
import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

type RefreshFn = (widgetIds?: string[]) => Promise<unknown>;

/**
 * When runtime filters change, refresh only affected data widgets.
 * Shared by studio filter context and external viewers.
 */
export function useDashboardChartRefresh(params: {
  widgets: WidgetInstance[];
  runtimeFilters: RuntimeFilter[];
  globalFilters: DashboardFilter[];
  pageFilters: DashboardFilter[];
  refreshCharts: RefreshFn;
  enabled?: boolean;
  /** Reset prev snapshot when dashboard or load cycle changes */
  resetKey?: string | null;
}) {
  const { widgets, runtimeFilters, globalFilters, pageFilters, refreshCharts, enabled = true, resetKey } = params;
  const prevFiltersRef = useRef<RuntimeFilter[]>([]);

  // Keyed by content, not the (unstable) array references, so this stays a
  // stable object across re-renders unless the filters actually changed —
  // otherwise every consumer downstream (fetchFilterOptions, load effects)
  // sees a "new" value every render and refetches in a tight loop.
  const filtersContentKey = JSON.stringify({ globalFilters, pageFilters });
  const combinedFiltersConfig = useMemo(
    () => mergeFilterConfigs(globalFilters, pageFilters, { markPageAsNonGlobal: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by content, not array refs
    [filtersContentKey],
  );

  useEffect(() => {
    prevFiltersRef.current = [];
  }, [resetKey]);

  const refreshAffected = useCallback(
    (prev: RuntimeFilter[], next: RuntimeFilter[]) => {
      if (prev.length === 0 && next.length > 0) {
        const all = getAffectedWidgetIds(widgets, next, combinedFiltersConfig);
        if (all.length) void refreshCharts(all);
        return;
      }

      const fields = new Set([...prev.map((f) => f.field), ...next.map((f) => f.field)]);
      const changedFields = Array.from(fields).filter((field) => {
        const old = prev.filter((p) => p.field === field).map((p) => ({ operator: p.operator, value: p.value }));
        const current = next.filter((p) => p.field === field).map((p) => ({ operator: p.operator, value: p.value }));
        return JSON.stringify(old) !== JSON.stringify(current);
      });

      const affected = getAffectedWidgetIds(
        widgets,
        next,
        combinedFiltersConfig,
        changedFields.length ? changedFields : undefined,
      );
      if (affected.length) void refreshCharts(affected);
    },
    [widgets, combinedFiltersConfig, refreshCharts],
  );

  useEffect(() => {
    if (!enabled || !widgets.length) return;

    const prevJson = JSON.stringify(prevFiltersRef.current);
    const nextJson = JSON.stringify(runtimeFilters);
    if (prevJson === nextJson) return;

    const prev = prevFiltersRef.current;
    prevFiltersRef.current = runtimeFilters;
    if (prev.length === 0 && runtimeFilters.length === 0) return;

    refreshAffected(prev, runtimeFilters);
  }, [enabled, runtimeFilters, widgets, refreshAffected]);

  return { combinedFiltersConfig };
}
