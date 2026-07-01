'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { chartService } from '../services/chartService';
import {
  fetchWidgetChartData,
  refreshWidgetsBatchData,
} from '../services/dashboardDataService';
import { useDashboardCrossFilter } from './useDashboardCrossFilter';
import {
  buildDefaultRuntimeFilters,
  type RuntimeFilter,
} from '../utils/filterOperators';
import { getAffectedWidgetIds } from '../utils/affectedWidgetIds';
import { mergeFilterConfigs, mergeFilterDefaults } from '../utils/filterConfigMerge';
import { partitionSeriesData } from '../utils/chartDataProcessing';
import { executiveMetaFromConfig } from '../utils/dashboardExecutiveMeta';
import {
  DEFAULT_AUTO_REFRESH_MINUTES,
  formatLastRefreshed,
  isDataWidget,
  runWithConcurrency,
} from '../utils/dashboardRefresh';
import { filterVisibleLayout, filterVisibleWidgets } from '../utils/dashboardViewerScope';
import {
  fetchEmbedDashboardPayload,
  mapEmbedLayout,
  normalizeEmbedWidget,
} from '../utils/embedDashboard';
import type { DashboardFilter } from '@/types/dashboard';
import type { DashboardPageItem } from '../components/DashboardPageTabs';
import type { LayoutItem, WidgetInstance } from '../stores/useDashboardStore';
import type { DashboardViewerMeta } from '../components/viewer/DashboardViewerShell';
import { normalizeDashboardFilters } from '../utils/normalizeDashboardFilters';

export type DashboardViewerMode = 'auth' | 'embed';

export type UseDashboardViewerStateOptions = {
  mode: DashboardViewerMode;
  embedToken?: string;
  /** Auth/shared mode: sync ?page= and ?filters= to this path */
  urlSyncBasePath?: string;
  initialAutoRefreshMinutes?: number;
  onReady?: (info: { widgetCount: number }) => void;
  onError?: (message: string) => void;
  onResize?: (heightPx: number) => void;
};

/**
 * Read-only dashboard viewer state shared by /shared/dashboards and /embed/dashboard.
 * Auth mode loads charts via API; embed mode uses the embed payload then batch refresh.
 */
export function useDashboardViewerState(
  dashboardId: string,
  options: UseDashboardViewerStateOptions,
) {
  const {
    mode,
    embedToken: embedTokenOption,
    urlSyncBasePath,
    initialAutoRefreshMinutes,
    onReady,
    onError,
    onResize,
  } = options;

  const t = useTranslations('dashboard_viewer');
  const td = useTranslations('dashboards');
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageIdParam = searchParams?.get('page') || searchParams?.get('page_id') || '';
  const filtersParam = searchParams?.get('filters') || '';
  const embedToken = embedTokenOption || searchParams?.get('token') || '';
  const accessOpts = useMemo(() => (embedToken ? { embedToken } : undefined), [embedToken]);

  const [meta, setMeta] = useState<DashboardViewerMeta | null>(null);
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [globalFilters, setGlobalFilters] = useState<DashboardFilter[]>([]);
  const [pageFilters, setPageFilters] = useState<DashboardFilter[]>([]);
  const [runtimeFilters, setRuntimeFilters] = useState<RuntimeFilter[]>([]);
  const [pages, setPages] = useState<DashboardPageItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(pageIdParam || null);
  const [defaultPageId, setDefaultPageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(
    initialAutoRefreshMinutes ?? (mode === 'embed' ? 0 : DEFAULT_AUTO_REFRESH_MINUTES),
  );

  const prevFiltersRef = useRef<RuntimeFilter[]>([]);
  const initialFetchDoneRef = useRef(false);
  const skipPageDefaultsRef = useRef(Boolean(filtersParam));

  const combinedFiltersConfig = useMemo(
    () => mergeFilterConfigs(globalFilters, pageFilters, { markPageAsNonGlobal: true }),
    [globalFilters, pageFilters],
  );

  const pageFilterFields = useMemo(
    () => pageFilters.map((f) => f.field).filter(Boolean),
    [pageFilters],
  );

  useEffect(() => {
    if (!filtersParam) return;
    try {
      const parsed = JSON.parse(decodeURIComponent(filtersParam));
      if (Array.isArray(parsed)) setRuntimeFilters(parsed);
    } catch {
      /* ignore */
    }
  }, [filtersParam]);

  const executeWidget = useCallback(
    async (widget: WidgetInstance) => {
      if (!isDataWidget(widget) || !dashboardId) return;

      setWidgets((prev) =>
        prev.map((w) => (w.id === widget.id ? { ...w, isLoading: true, error: null } : w)),
      );

      try {
        const { chartData, chartOptions } = await fetchWidgetChartData({
          dashboardId,
          widget,
          runtimeFilters,
          filterConfigs: combinedFiltersConfig,
          accessOpts,
        });
        setWidgets((prev) =>
          prev.map((w) =>
            w.id === widget.id
              ? {
                  ...w,
                  chartData,
                  chartOptions: chartOptions
                    ? { ...(w.chartOptions || {}), ...chartOptions }
                    : w.chartOptions,
                  isLoading: false,
                  error: null,
                }
              : w,
          ),
        );
        setLastRefreshedAt(new Date());
      } catch {
        setWidgets((prev) =>
          prev.map((w) =>
            w.id === widget.id ? { ...w, isLoading: false, error: t('data_unavailable') } : w,
          ),
        );
      }
    },
    [dashboardId, runtimeFilters, combinedFiltersConfig, t, accessOpts],
  );

  const executeWidgetsBatch = useCallback(
    async (targetWidgets: WidgetInstance[]) => {
      const dataWidgets = targetWidgets.filter(isDataWidget);
      if (!dataWidgets.length || !dashboardId) return;

      setWidgets((prev) =>
        prev.map((w) =>
          dataWidgets.some((tw) => tw.id === w.id) ? { ...w, isLoading: true, error: null } : w,
        ),
      );

      try {
        const batch = await refreshWidgetsBatchData({
          dashboardId,
          widgets: dataWidgets,
          runtimeFilters,
          filterConfigs: combinedFiltersConfig,
          accessOpts,
        });

        setWidgets((prev) =>
          prev.map((w) => {
            const result = batch.results.find((r) => r.widget_id === w.id);
            if (!result) return w;
            if (!result.success) {
              return { ...w, isLoading: false, error: result.error || t('data_unavailable') };
            }
            return {
              ...w,
              chartData: partitionSeriesData(result.data!, w),
              isLoading: false,
              error: null,
            };
          }),
        );
        setLastRefreshedAt(new Date());
      } catch {
        await runWithConcurrency(dataWidgets, (w) => executeWidget(w));
      }
    },
    [dashboardId, runtimeFilters, combinedFiltersConfig, t, executeWidget, accessOpts],
  );

  const loadPages = useCallback(async () => {
    if (!dashboardId) return [];
    try {
      const pageList = await chartService.listPages(dashboardId, accessOpts);
      const normalized: DashboardPageItem[] = pageList.map(
        (p: { id: string; name: string; filters?: DashboardFilter[] }) => ({
          id: String(p.id),
          name: p.name,
          filters: normalizeDashboardFilters(p.filters),
        }),
      );
      setPages(normalized);
      if (normalized[0]?.id) {
        setDefaultPageId((prev) => prev ?? String(normalized[0].id));
      }
      return normalized;
    } catch {
      setPages([]);
      return [];
    }
  }, [dashboardId, accessOpts]);

  const loadAuthDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [charts, dashInfo, pageList] = await Promise.all([
        chartService.listCharts(dashboardId, accessOpts).catch(() => {
          throw new Error(t('load_content_failed'));
        }),
        chartService.getDashboard(dashboardId, accessOpts).catch(() => null),
        loadPages(),
      ]);

      try {
        if (!dashInfo) throw new Error(t('load_failed'));
        const cfg = dashInfo.config || {};
        const filterSourceChart = charts.find(
          (chart: Record<string, unknown>) => chart.dataSourceId,
        ) as Record<string, unknown> | undefined;
        const filterSourceQuery =
          (filterSourceChart?.chartQuery as Record<string, unknown> | undefined) || {};
        const filterDataContext = {
          dataSourceId: filterSourceChart?.dataSourceId as string | undefined,
          tableName: filterSourceQuery.tableName as string | undefined,
        };
        const execMeta = executiveMetaFromConfig(cfg);
        setMeta({
          id: dashboardId,
          title: dashInfo.title || dashInfo.name || t('default_title'),
          description: dashInfo.description || '',
          keyInsight: execMeta.keyInsight,
          storyArc: execMeta.storyArc,
        });
        const gf = normalizeDashboardFilters(cfg.global_filters, filterDataContext);
        setGlobalFilters(gf);

        if (!filtersParam) {
          const defaults = buildDefaultRuntimeFilters(gf);
          if (defaults.length) {
            setRuntimeFilters(defaults);
            prevFiltersRef.current = defaults;
          }
        }

        const defaultPage = String(cfg.default_page_id || pageList[0]?.id || '');
        setDefaultPageId(defaultPage || null);
        if (!pageIdParam && defaultPage) setActivePageId(defaultPage);
      } catch {
        setMeta({ id: dashboardId, title: t('default_title'), description: '' });
      }

      const initialWidgets: WidgetInstance[] = charts.map((chart: Record<string, unknown>) => ({
        id: `widget-${chart.id}`,
        chartId: chart.id as string,
        dataSourceId: chart.dataSourceId as string | undefined,
        title: (chart.title as string) || '',
        chartType: chart.chartType as WidgetInstance['chartType'],
        chartQuery: chart.chartQuery as WidgetInstance['chartQuery'],
        chartOptions: chart.chartOptions as WidgetInstance['chartOptions'],
        chartData: undefined,
        isLoading: isDataWidget({
          chartType: chart.chartType as string,
          chartId: chart.id as string,
          dataSourceId: chart.dataSourceId as string,
        }),
        error: null,
      }));

      const initialLayout: LayoutItem[] = charts.map((chart: Record<string, unknown>) => {
        const chartLayout = (chart.layout || {}) as Record<string, unknown>;
        return {
          i: `widget-${chart.id}`,
          x: (chartLayout.x as number) ?? 0,
          y: (chartLayout.y as number) ?? 0,
          w: (chartLayout.w as number) ?? 4,
          h: (chartLayout.h as number) ?? 5,
          ...(chartLayout.page_id ? { pageId: String(chartLayout.page_id) } : {}),
        };
      });

      setWidgets(initialWidgets);
      setLayout(initialLayout);
      initialFetchDoneRef.current = true;
      setLastRefreshedAt(new Date());
      onReady?.({ widgetCount: initialWidgets.length });
      void executeWidgetsBatch(initialWidgets.filter((w) => w.isLoading));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('load_failed');
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [
    dashboardId,
    accessOpts,
    t,
    filtersParam,
    pageIdParam,
    loadPages,
    executeWidgetsBatch,
    onReady,
    onError,
  ]);

  const loadEmbedDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchEmbedDashboardPayload(dashboardId, { token: embedToken || undefined });
      const cfg = data.config || {};
      const gf = normalizeDashboardFilters(data.global_filters || cfg.global_filters);
      setGlobalFilters(gf);
      const execMeta = executiveMetaFromConfig(cfg);
      setMeta({
        id: dashboardId,
        title: data.name || t('default_title'),
        description: data.description || '',
        keyInsight: execMeta.keyInsight,
        storyArc: execMeta.storyArc,
      });

      const normalized = (data.widgets || []).map((w) => normalizeEmbedWidget(w, t('data_unavailable')));
      setWidgets(normalized);
      setLayout(mapEmbedLayout(data.layout || []));

      const defaultPage = cfg.default_page_id ? String(cfg.default_page_id) : null;
      if (defaultPage) setDefaultPageId(defaultPage);
      if (!pageIdParam && defaultPage) setActivePageId(defaultPage);

      if (!filtersParam && gf.length) {
        const defaults = buildDefaultRuntimeFilters(gf);
        if (defaults.length) {
          setRuntimeFilters(defaults);
          prevFiltersRef.current = defaults;
        }
      }

      await loadPages();
      initialFetchDoneRef.current = true;
      setLastRefreshedAt(new Date());
      onReady?.({ widgetCount: normalized.length });

      const needsRefresh = normalized.filter(
        (w) => isDataWidget(w) && !w.chartData && !w.error,
      );
      if (needsRefresh.length) void executeWidgetsBatch(needsRefresh);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('load_failed');
      setError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [
    dashboardId,
    embedToken,
    t,
    filtersParam,
    pageIdParam,
    loadPages,
    executeWidgetsBatch,
    onReady,
    onError,
  ]);

  useEffect(() => {
    if (!dashboardId) return;
    initialFetchDoneRef.current = false;
    prevFiltersRef.current = [];
    if (mode === 'auth') void loadAuthDashboard();
    else void loadEmbedDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when dashboard or access token changes
  }, [dashboardId, mode, embedToken]);

  useEffect(() => {
    if (pageIdParam) setActivePageId(pageIdParam);
  }, [pageIdParam]);

  useEffect(() => {
    const page = pages.find((p) => p.id === activePageId);
    setPageFilters(page?.filters || []);
  }, [activePageId, pages]);

  useEffect(() => {
    if (mode !== 'embed') return;
    if (skipPageDefaultsRef.current || !pages.length) return;
    const page = pages.find((p) => p.id === activePageId);
    const defaults = mergeFilterDefaults(globalFilters, page?.filters || []);
    if (defaults.length) setRuntimeFilters(defaults);
  }, [mode, activePageId, pages, globalFilters]);

  const visibleWidgets = useMemo(
    () => filterVisibleWidgets(widgets, layout, activePageId, pages, defaultPageId),
    [widgets, layout, activePageId, pages, defaultPageId],
  );

  const visibleLayout = useMemo(
    () => filterVisibleLayout(layout, visibleWidgets),
    [layout, visibleWidgets],
  );

  useEffect(() => {
    if (!initialFetchDoneRef.current || !widgets.length) return;
    const prevJson = JSON.stringify(prevFiltersRef.current);
    const nextJson = JSON.stringify(runtimeFilters);
    if (prevJson === nextJson) return;

    const prev = prevFiltersRef.current;
    prevFiltersRef.current = runtimeFilters;
    if (prev.length === 0) return;

    const changedFields = runtimeFilters
      .filter((f) => {
        const old = prev.find((p) => p.field === f.field);
        return !old || JSON.stringify(old.value) !== JSON.stringify(f.value);
      })
      .map((f) => f.field);

    const affected = getAffectedWidgetIds(
      widgets,
      runtimeFilters,
      combinedFiltersConfig,
      changedFields.length ? changedFields : undefined,
    )
      .map((id) => widgets.find((x) => x.id === id))
      .filter((w): w is WidgetInstance => !!w);

    if (affected.length) void executeWidgetsBatch(affected);
  }, [runtimeFilters, combinedFiltersConfig, widgets, executeWidgetsBatch]);

  const pageFiltersKey = JSON.stringify(pageFilters);
  useEffect(() => {
    if (!initialFetchDoneRef.current) return;
    const missing = visibleWidgets.filter(
      (w) => isDataWidget(w) && !w.chartData && !w.isLoading && !w.error,
    );
    if (missing.length) void executeWidgetsBatch(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when page filters or visible set changes
  }, [activePageId, pageFiltersKey, visibleWidgets.length, executeWidgetsBatch]);

  useEffect(() => {
    if (mode !== 'embed' || isLoading || !meta || !onResize) return;
    const maxY = visibleLayout.reduce((acc, l) => Math.max(acc, (l.y || 0) + (l.h || 5)), 0);
    onResize(Math.max(480, 120 + maxY * 42));
  }, [mode, isLoading, meta, visibleLayout, onResize]);

  const syncUrl = useCallback(
    (nextPageId: string | null, filters: RuntimeFilter[]) => {
      if (!urlSyncBasePath) return;
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('id', dashboardId);
      if (nextPageId) params.set('page', nextPageId);
      else params.delete('page');
      if (filters.length) params.set('filters', encodeURIComponent(JSON.stringify(filters)));
      else params.delete('filters');
      router.replace(`${urlSyncBasePath}?${params.toString()}`, { scroll: false });
    },
    [dashboardId, router, searchParams, urlSyncBasePath],
  );

  const postEmbedNavigate = useCallback((filters: RuntimeFilter[]) => {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage({ source: 'aicser-embed', type: 'navigate', payload: { filters } }, '*');
  }, []);

  const handleRuntimeChange = useCallback(
    (filters: RuntimeFilter[]) => {
      setRuntimeFilters(filters);
      syncUrl(activePageId, filters);
      postEmbedNavigate(filters);
    },
    [activePageId, syncUrl, postEmbedNavigate],
  );

  const handleCrossFilter = useDashboardCrossFilter(runtimeFilters, handleRuntimeChange);

  const handlePageSelect = useCallback(
    (nextPageId: string) => {
      skipPageDefaultsRef.current = false;
      setActivePageId(nextPageId);
      syncUrl(nextPageId, runtimeFilters);
    },
    [runtimeFilters, syncUrl],
  );

  const handleRetryWidget = useCallback(
    (widgetId: string) => {
      const w = widgets.find((x) => x.id === widgetId);
      if (w) void executeWidget(w);
    },
    [widgets, executeWidget],
  );

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    const targets = visibleWidgets.filter(isDataWidget);
    void executeWidgetsBatch(targets).finally(() => setRefreshing(false));
  }, [visibleWidgets, executeWidgetsBatch]);

  useEffect(() => {
    if (!autoRefreshMinutes) return;
    const ms = autoRefreshMinutes * 60 * 1000;
    const id = window.setInterval(() => handleManualRefresh(), ms);
    return () => window.clearInterval(id);
  }, [autoRefreshMinutes, handleManualRefresh]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const staleMs = autoRefreshMinutes * 60 * 1000;
      if (!autoRefreshMinutes || !lastRefreshedAt || Date.now() - lastRefreshedAt.getTime() >= staleMs) {
        handleManualRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [autoRefreshMinutes, lastRefreshedAt, handleManualRefresh]);

  const lastRefreshedLabel = formatLastRefreshed(lastRefreshedAt, (key, values) => td(key, values));

  const fetchFilterOptions = useCallback(
    (
      field: string,
      dataSourceId: string,
      ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
    ) => {
      const filterDef = combinedFiltersConfig.find((f) => f.field === field);
      return chartService
        .getFilterOptions(dashboardId, field, dataSourceId, {
          embedToken: accessOpts?.embedToken,
          tableName: ctx?.tableName || filterDef?.tableName,
          runtimeFilters: ctx?.runtimeFilters ?? runtimeFilters,
          excludeField: ctx?.excludeField || field,
        })
        .then((r) => (Array.isArray(r?.values) ? r.values : []));
    },
    [dashboardId, combinedFiltersConfig, runtimeFilters, accessOpts],
  );

  const fetchFilterFieldStats = useCallback(
    (
      field: string,
      dataSourceId: string,
      ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
    ) => {
      const filterDef = combinedFiltersConfig.find((f) => f.field === field);
      return chartService.getFilterFieldStats(dashboardId, field, dataSourceId, {
        embedToken: accessOpts?.embedToken,
        tableName: ctx?.tableName || filterDef?.tableName,
        runtimeFilters: ctx?.runtimeFilters ?? runtimeFilters,
      });
    },
    [dashboardId, combinedFiltersConfig, runtimeFilters, accessOpts],
  );

  return {
    meta,
    pages,
    activePageId,
    combinedFiltersConfig,
    pageFilterFields,
    runtimeFilters,
    visibleWidgets,
    visibleLayout,
    isLoading,
    refreshing,
    error,
    handlePageSelect,
    handleRuntimeChange,
    handleCrossFilter,
    handleRetryWidget,
    handleManualRefresh,
    fetchFilterOptions,
    fetchFilterFieldStats,
    autoRefreshMinutes,
    setAutoRefreshMinutes,
    lastRefreshedLabel,
  };
}

export default useDashboardViewerState;
