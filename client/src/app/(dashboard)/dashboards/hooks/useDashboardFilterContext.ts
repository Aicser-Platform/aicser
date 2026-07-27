'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { message } from 'antd';
import { useTranslations } from 'next-intl';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useDashboardCrossFilter } from './useDashboardCrossFilter';
import { chartService } from '../services/chartService';
import { buildDefaultRuntimeFilters } from '../utils/filterOperators';
import { mergeFilterDefaults } from '../utils/filterConfigMerge';
import { detectFilterFieldConflicts } from '../utils/filterConflicts';
import { filterVisibleLayout, filterVisibleWidgets } from '../utils/dashboardViewerScope';
import { useDashboardChartRefresh } from './useDashboardChartRefresh';
import { enrichFiltersWithTableNames } from '../utils/filterSchemaColumns';
import { useDataSources } from '@/hooks/useDataSources';
import { useDashboardRefresh } from './useDashboardRefresh';
import { isDataWidget } from '../utils/dashboardRefresh';
import { decodeDrillStateParam, encodeDrillStateParam, getDrillPath, getInteractionMode } from '../utils/drillDownHelpers';
import { normalizeDashboardFilters } from '../utils/normalizeDashboardFilters';
import type { DashboardFilter } from '@/types/dashboard';
import type { DashboardPageItem } from '../components/DashboardPageTabs';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

export function useDashboardFilterContext(projectId?: string | number | null) {
  const t = useTranslations('dashboards');
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const widgets = useDashboardStore((s) => s.widgets);
  const layout = useDashboardStore((s) => s.layout);
  const runtimeFilters = useDashboardStore((s) => s.runtimeFilters);
  const setRuntimeFilters = useDashboardStore((s) => s.setRuntimeFilters);
  const globalFiltersConfig = useDashboardStore((s) => s.globalFiltersConfig);
  const setGlobalFiltersConfig = useDashboardStore((s) => s.setGlobalFiltersConfig);
  const pageFiltersConfig = useDashboardStore((s) => s.pageFiltersConfig);
  const setPageFiltersConfig = useDashboardStore((s) => s.setPageFiltersConfig);
  const refreshAllChartData = useDashboardStore((s) => s.refreshAllChartData);
  const updatePageLayout = useDashboardStore((s) => s.updatePageLayout);
  const updateChartLayout = useDashboardStore((s) => s.updateChartLayout);
  const moveWidgetToPage = useDashboardStore((s) => s.moveWidgetToPage);
  const widgetDrillState = useDashboardStore((s) => s.widgetDrillState);
  const setWidgetDrillState = useDashboardStore((s) => s.setWidgetDrillState);

  const [filtersPanelOpen, setFiltersPanelOpenState] = useState(false);
  const [filtersEditorOpen, setFiltersEditorOpen] = useState(false);
  const [pageFiltersEditorOpen, setPageFiltersEditorOpen] = useState(false);
  const [pages, setPages] = useState<DashboardPageItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const defaultPageIdRef = useRef<string | null>(null);
  const initialLoadDoneRef = useRef(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const skipPageDefaultsRef = useRef(false);
  const prevFiltersRef = useRef<typeof runtimeFilters>([]);
  const prevPageIdRef = useRef<string | null>(null);

  const { dataSources } = useDataSources(
    isEnterpriseEdition && projectId != null ? String(projectId) : undefined
  );

  const refreshVisibleCharts = useCallback(
    (widgetIds?: string[]) => {
      return refreshAllChartData(widgetIds);
    },
    [refreshAllChartData]
  );

  const panelPrefKey = useMemo(
    () => (activeDashboardId ? `aiser_dashboard_filters_panel_${activeDashboardId}` : null),
    [activeDashboardId],
  );

  const setFiltersPanelOpen = useCallback(
    (open: boolean) => {
      setFiltersPanelOpenState(open);
      if (!panelPrefKey || typeof window === 'undefined') return;
      try {
        sessionStorage.setItem(panelPrefKey, open ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [panelPrefKey],
  );

  useEffect(() => {
    if (!activeDashboardId) {
      setGlobalFiltersConfig([]);
      setPageFiltersConfig([]);
      setPages([]);
      setActivePageId(null);
      initialLoadDoneRef.current = false;
      setInitialLoadDone(false);
      skipPageDefaultsRef.current = false;
      prevFiltersRef.current = [];
      prevPageIdRef.current = null;
      return;
    }

    initialLoadDoneRef.current = false;
    setInitialLoadDone(false);
    skipPageDefaultsRef.current = false;
    prevFiltersRef.current = [];
    // Clear page state immediately so a stale page UUID from another dashboard
    // cannot hide widgets (unassigned layout only shows on the default page).
    setPages([]);
    setActivePageId(null);
    defaultPageIdRef.current = null;
    prevPageIdRef.current = null;
    const urlPage = searchParams?.get('page') || searchParams?.get('page_id');
    const urlFilters = searchParams?.get('filters');
    const urlDrill = searchParams?.get('drill');
    if (urlDrill) {
      const decoded = decodeDrillStateParam(urlDrill);
      Object.entries(decoded).forEach(([widgetId, state]) => {
        setWidgetDrillState(widgetId, state);
      });
    }

    let cancelled = false;
    const load = async () => {
      try {
        const dash = await chartService.getDashboard(activeDashboardId);
        if (cancelled) return;

        useDashboardStore.getState().setDashboardDescription(
          activeDashboardId,
          (dash as { description?: string }).description || ''
        );

        if (dash?.config && typeof dash.config === 'object') {
          useDashboardStore.setState((s) => ({
            dashboards: s.dashboards.map((d) =>
              d.id === activeDashboardId ? { ...d, config: dash.config as Record<string, unknown> } : d,
            ),
          }));
        }

        const filterSourceWidget = useDashboardStore
          .getState()
          .widgets.find((widget) => widget.dataSourceId);
        const filterDataContext = {
          dataSourceId: filterSourceWidget?.dataSourceId,
          tableName: filterSourceWidget?.chartQuery?.tableName,
        };
        let cfgFilters = normalizeDashboardFilters(
          dash?.config?.global_filters,
          filterDataContext,
        );

        // ── AI-seeded global filters (from chat dashboard creation) ──────────────
        // When a dashboard is opened immediately after AI generation, check sessionStorage
        // for filter suggestions from the AI planner and bootstrap the filter bar.
        if (typeof window !== 'undefined') {
          try {
            const aiFilterKey = `aiser_ai_filters_${activeDashboardId}`;
            const aiFiltersRaw = sessionStorage.getItem(aiFilterKey);
            if (aiFiltersRaw) {
              sessionStorage.removeItem(aiFilterKey); // consume once
              const aiFilters: Array<{ type: string; field: string; label: string; default?: string; multi?: boolean }> =
                JSON.parse(aiFiltersRaw);
              if (Array.isArray(aiFilters) && aiFilters.length > 0 && cfgFilters.length === 0) {
                // Convert AI filter descriptors to DashboardFilter format
                const mapped = normalizeDashboardFilters(aiFilters, filterDataContext);
                cfgFilters = mapped;
                // Persist to dashboard config so filters survive future opens
                try {
                  await chartService.updateDashboard(activeDashboardId, {
                    config: { ...(dash.config || {}), global_filters: mapped },
                  });
                } catch {
                  /* non-fatal — filters still apply for this session */
                }
              }
            }
          } catch {
            /* sessionStorage or JSON parse error — ignore */
          }
        }
        // ─────────────────────────────────────────────────────────────────────────

        setGlobalFiltersConfig(cfgFilters);
        let initialPanelOpen = false;
        if (typeof window !== 'undefined' && panelPrefKey) {
          try {
            const persisted = sessionStorage.getItem(panelPrefKey);
            if (persisted === '1') initialPanelOpen = true;
            else if (persisted === '0') initialPanelOpen = false;
            else initialPanelOpen = cfgFilters.length > 0;
          } catch {
            initialPanelOpen = cfgFilters.length > 0;
          }
        } else {
          initialPanelOpen = cfgFilters.length > 0;
        }
        setFiltersPanelOpenState(initialPanelOpen);

        let pageList: DashboardPageItem[] = [];
        let resolvedPageId: string | null = null;
        try {
          const rawPages = await chartService.listPages(activeDashboardId);
          if (cancelled) return;
          pageList = rawPages.map((p: { id: string; name: string; filters?: DashboardFilter[] }) => ({
            id: String(p.id),
            name: p.name,
            filters: normalizeDashboardFilters(p.filters, filterDataContext),
          }));

          if (pageList.length === 0) {
            const created = await chartService.createPage(activeDashboardId, 'Page 1');
            if (cancelled) return;
            pageList = [
              {
                id: String(created.id),
                name: created.name || 'Page 1',
                filters: normalizeDashboardFilters(created.filters, filterDataContext),
              },
            ];
            await chartService.setDefaultPage(activeDashboardId, pageList[0].id);
          }

          setPages(pageList);
          const defaultPage = String(dash?.config?.default_page_id || pageList[0]?.id || '');
          defaultPageIdRef.current = defaultPage || null;
          const urlPageValid =
            urlPage && pageList.some((p) => String(p.id) === String(urlPage))
              ? String(urlPage)
              : null;
          const nextPageId = urlPageValid || defaultPage || null;
          resolvedPageId = nextPageId;
          setActivePageId(nextPageId);
          const activePage = pageList.find((p) => p.id === nextPageId);
          setPageFiltersConfig(activePage?.filters || []);
        } catch {
          setPages([]);
          setActivePageId(null);
        }

        if (urlFilters) {
          try {
            const parsed = JSON.parse(decodeURIComponent(urlFilters));
            if (Array.isArray(parsed)) {
              setRuntimeFilters(parsed);
              prevFiltersRef.current = parsed;
              skipPageDefaultsRef.current = true;
            }
          } catch {
            /* ignore */
          }
        } else {
          const activePage = pageList.find((p) => p.id === (resolvedPageId || defaultPageIdRef.current));
          const defaults = mergeFilterDefaults(cfgFilters, activePage?.filters || []);
          if (defaults.length) {
            setRuntimeFilters(defaults);
            prevFiltersRef.current = defaults;
          }
        }
        initialLoadDoneRef.current = true;
        setInitialLoadDone(true);
        prevPageIdRef.current = resolvedPageId;
      } catch {
        if (!cancelled) {
          setGlobalFiltersConfig([]);
          setPages([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeDashboardId, panelPrefKey, setRuntimeFilters, setGlobalFiltersConfig, setPageFiltersConfig, refreshVisibleCharts]);

  // External URL page changes (browser back/forward) without reloading dashboard config.
  const urlPageParam = searchParams?.get('page') || searchParams?.get('page_id') || null;
  useEffect(() => {
    if (!initialLoadDoneRef.current || !urlPageParam || urlPageParam === activePageId) return;
    if (pages.some((p) => p.id === urlPageParam)) {
      setActivePageId(urlPageParam);
    }
  }, [urlPageParam, activePageId, pages]);

  useEffect(() => {
    if (!activePageId) {
      setPageFiltersConfig([]);
      return;
    }
    const page = pages.find((p) => p.id === activePageId);
    setPageFiltersConfig(page?.filters || []);

    if (!initialLoadDoneRef.current || skipPageDefaultsRef.current) return;

    const pageDefaults = buildDefaultRuntimeFilters(page?.filters || []);
    if (!pageDefaults.length) return;

    const prev = useDashboardStore.getState().runtimeFilters;
    const fields = new Set(prev.map((f) => f.field));
    const merged = [...prev];
    pageDefaults.forEach((d) => {
      if (!fields.has(d.field)) merged.push(d);
    });
    if (merged.length !== prev.length) {
      setRuntimeFilters(merged);
    }
  }, [activePageId, pages, setPageFiltersConfig, setRuntimeFilters]);

  const { combinedFiltersConfig } = useDashboardChartRefresh({
    widgets,
    runtimeFilters,
    globalFilters: globalFiltersConfig,
    pageFilters: pageFiltersConfig,
    refreshCharts: refreshVisibleCharts,
    enabled: initialLoadDone,
    resetKey: activeDashboardId,
  });

  useEffect(() => {
    if (!activeDashboardId || typeof window === 'undefined' || !initialLoadDoneRef.current) return;

    const params = new URLSearchParams();
    params.set('id', String(activeDashboardId));
    const pageBelongs =
      activePageId && pages.some((p) => String(p.id) === String(activePageId));
    if (pageBelongs) params.set('page', String(activePageId));
    if (runtimeFilters.length) {
      params.set('filters', encodeURIComponent(JSON.stringify(runtimeFilters)));
    }
    const drillEncoded = encodeDrillStateParam(widgetDrillState);
    if (drillEncoded) {
      params.set('drill', drillEncoded);
    }
    const next = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (next === current) return;
    router.replace(`?${next}`, { scroll: false });
  }, [activeDashboardId, activePageId, pages, runtimeFilters, widgetDrillState, router]);

  // Same scoping rules as the shared viewer: widgets on the active page only,
  // unassigned/stale-page widgets on the default page, empty pages stay empty
  // (no fallback to all widgets — that made new tabs look identical to page 1).
  const pageWidgets = useMemo(
    () => filterVisibleWidgets(widgets, layout, activePageId, pages, defaultPageIdRef.current),
    [widgets, layout, activePageId, pages]
  );
  const pageLayout = useMemo(() => filterVisibleLayout(layout, pageWidgets), [layout, pageWidgets]);

  const getVisibleTargetIds = useCallback(
    () =>
      pageWidgets.filter((w) => isDataWidget(w)).map((w) => w.id),
    [pageWidgets]
  );

  const studioMode = useDashboardStore((s) => s.studioMode);

  const refreshControl = useDashboardRefresh({
    getTargetIds: getVisibleTargetIds,
    refreshWidgets: refreshVisibleCharts,
    studioMode,
    defaultAutoRefreshInView: true,
  });

  const initialRefreshMarkedRef = useRef(false);

  useEffect(() => {
    if (!activeDashboardId) {
      initialRefreshMarkedRef.current = false;
      return;
    }
    initialRefreshMarkedRef.current = false;
  }, [activeDashboardId]);

  useEffect(() => {
    if (!activeDashboardId || initialRefreshMarkedRef.current) return;
    const dataWidgets = pageWidgets.filter((w) => isDataWidget(w));
    if (!dataWidgets.length) {
      refreshControl.noteRefreshComplete();
      initialRefreshMarkedRef.current = true;
      return;
    }
    const settled = dataWidgets.every((w) => !w.isLoading);
    const hasData = dataWidgets.some((w) => w.chartData && !w.error);
    if (settled && hasData) {
      refreshControl.noteRefreshComplete();
      initialRefreshMarkedRef.current = true;
    }
  }, [activeDashboardId, pageWidgets, refreshControl.noteRefreshComplete]);

  useEffect(() => {
    if (!initialLoadDoneRef.current || !activePageId) return;
    if (prevPageIdRef.current === activePageId) return;
    prevPageIdRef.current = activePageId;

    const missing = pageWidgets.filter(
      (w) => isDataWidget(w) && (!w.chartData || w.error) && !w.isLoading
    );
    if (missing.length) {
      void refreshVisibleCharts(missing.map((w) => w.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch when active page changes
  }, [activePageId]);

  const handleRuntimeFiltersChange = useCallback(
    (filters: typeof runtimeFilters) => {
      prevFiltersRef.current = filters;
      setRuntimeFilters(filters);
    },
    [setRuntimeFilters],
  );

  const handleCrossFilter = useDashboardCrossFilter(runtimeFilters, handleRuntimeFiltersChange);
  const drillInto = useDashboardStore((s) => s.drillInto);

  const handleDrillThrough = useCallback(
    (widget: (typeof widgets)[number], field: string, value: unknown) => {
      const dt = widget.chartQuery?.drillThrough;
      if (!dt?.targetPageId) return;
      const filterField = dt.filterField || field;
      setActivePageId(String(dt.targetPageId));
      handleCrossFilter(filterField, value);
    },
    [handleCrossFilter, setActivePageId]
  );

  const handleWidgetChartClick = useCallback(
    (widget: (typeof widgets)[number], field: string, value: unknown, shiftKey: boolean) => {
      if (shiftKey) {
        handleCrossFilter(field, value);
        return;
      }
      if (widget.chartQuery?.drillThrough?.targetPageId) {
        handleDrillThrough(widget, field, value);
        return;
      }
      if (getInteractionMode(widget) === 'drill' && getDrillPath(widget).length > 0) {
        void drillInto(widget.id, field, value);
        return;
      }
      handleCrossFilter(field, value);
    },
    [handleCrossFilter, handleDrillThrough, drillInto]
  );

  const saveGlobalFilters = useCallback(
    async (filters: DashboardFilter[]) => {
      if (!activeDashboardId) return;
      const dash = await chartService.getDashboard(activeDashboardId);
      await chartService.updateDashboard(activeDashboardId, {
        config: { ...(dash.config || {}), global_filters: filters },
      });
      setGlobalFiltersConfig(filters);
      setFiltersPanelOpen(filters.length > 0);
      message.success(t('filters_saved'));
    },
    [activeDashboardId, setGlobalFiltersConfig, t]
  );

  const savePageFilters = useCallback(
    async (filters: DashboardFilter[]) => {
      if (!activeDashboardId || !activePageId) return;
      await chartService.updatePage(activeDashboardId, activePageId, { filters });
      setPages((prev) => prev.map((p) => (p.id === activePageId ? { ...p, filters } : p)));
      setPageFiltersConfig(filters);
      if (filters.length > 0) setFiltersPanelOpen(true);
      message.success(t('page_filters_saved'));
    },
    [activeDashboardId, activePageId, setPageFiltersConfig, t]
  );

  const dataSourceOptions = useMemo(() => {
    const ids = new Set<string>();
    widgets.forEach((w) => {
      if (w.dataSourceId) ids.add(String(w.dataSourceId));
    });
    dataSources.forEach((ds) => ids.add(String(ds.id)));
    const nameById = new Map(dataSources.map((ds) => [String(ds.id), ds.name || String(ds.id)]));
    return Array.from(ids).map((id) => ({
      value: id,
      label: nameById.get(id) || id.slice(0, 8),
    }));
  }, [widgets, dataSources]);

  const tableOptionsBySource = useMemo(() => {
    const map: Record<string, { value: string; label: string }[]> = {};
    dataSources.forEach((ds) => {
      const schema = (ds as { schema?: { tables?: unknown[] } }).schema;
      const tables = schema?.tables || [];
      map[String(ds.id)] = tables
        .map((tbl) => {
          const name = typeof tbl === 'string' ? tbl : (tbl as { name?: string }).name;
          return name ? { value: name, label: name } : null;
        })
        .filter(Boolean) as { value: string; label: string }[];
    });
    return map;
  }, [dataSources]);

  const widgetScopeOptions = useMemo(
    () =>
      widgets.map((w) => ({
        value: w.id,
        label: w.title?.trim() || w.chartType,
      })),
    [widgets]
  );

  const filterFieldConflicts = useMemo(
    () => detectFilterFieldConflicts(globalFiltersConfig, pageFiltersConfig, widgets),
    [globalFiltersConfig, pageFiltersConfig, widgets]
  );

  useEffect(() => {
    if (!dataSources.length) return;
    const dsPayload = dataSources.map((ds) => ({
      id: ds.id,
      schema: (ds as { schema?: { tables?: unknown[] } }).schema,
    }));
    const enrichedGlobal = enrichFiltersWithTableNames(globalFiltersConfig, dsPayload);
    if (JSON.stringify(enrichedGlobal) !== JSON.stringify(globalFiltersConfig)) {
      setGlobalFiltersConfig(enrichedGlobal);
    }
    const enrichedPage = enrichFiltersWithTableNames(pageFiltersConfig, dsPayload);
    if (JSON.stringify(enrichedPage) !== JSON.stringify(pageFiltersConfig)) {
      setPageFiltersConfig(enrichedPage);
    }
  }, [dataSources, globalFiltersConfig, pageFiltersConfig, setGlobalFiltersConfig, setPageFiltersConfig]);

  const fetchFilterOptions = useCallback(
    (field: string, dataSourceId: string, ctx?: { tableName?: string; runtimeFilters?: typeof runtimeFilters; excludeField?: string }) => {
      const filterDef =
        combinedFiltersConfig.find(
          (f) => f.field === field && String(f.dataSourceId || '') === String(dataSourceId),
        ) || combinedFiltersConfig.find((f) => f.field === field);
      if (!activeDashboardId) return Promise.resolve([]);
      return chartService
        .getFilterOptions(activeDashboardId, field, dataSourceId, {
          tableName: ctx?.tableName || filterDef?.tableName,
          runtimeFilters: ctx?.runtimeFilters ?? runtimeFilters,
          excludeField: ctx?.excludeField || field,
        })
        .then((r) => (Array.isArray(r?.values) ? r.values : []))
        .catch(() => [] as unknown[]);
    },
    [activeDashboardId, combinedFiltersConfig, runtimeFilters]
  );

  const fetchFilterFieldStats = useCallback(
    (field: string, dataSourceId: string, ctx?: { tableName?: string; runtimeFilters?: typeof runtimeFilters; excludeField?: string }) => {
      const filterDef =
        combinedFiltersConfig.find(
          (f) => f.field === field && String(f.dataSourceId || '') === String(dataSourceId),
        ) || combinedFiltersConfig.find((f) => f.field === field);
      if (!activeDashboardId) return Promise.resolve({ min: null, max: null });
      return chartService.getFilterFieldStats(activeDashboardId, field, dataSourceId, {
        tableName: ctx?.tableName || filterDef?.tableName,
        runtimeFilters: ctx?.runtimeFilters ?? runtimeFilters,
      });
    },
    [activeDashboardId, combinedFiltersConfig, runtimeFilters]
  );

  const handlePageLayoutChange = useCallback(
    (nextPageLayout: typeof layout) => {
      // Mirrors the guard in scheduleLayoutSync (page.tsx): widgets for the
      // active dashboard can render before pages/activePageId catch up, and
      // any layout react-grid-layout reports during that window is not
      // trustworthy (e.g. every widget collapsing to {x:0,y:index,w:1,h:1}).
      // scheduleLayoutSync only guards the backend *persist* -- without this
      // check here too, that same degenerate layout still overwrites the
      // real positions in the store (and gets cached per-dashboard on the
      // next switch), even though it never reaches the database.
      //
      // Collision policy lives in DashboardCanvas.commitLayout (swap / minimal
      // nudge on gesture end) — do not re-resolve here or mid-drag gets shoved.
      if (!initialLoadDoneRef.current) return;
      updatePageLayout(activePageId, nextPageLayout, defaultPageIdRef.current);
    },
    [activePageId, updatePageLayout]
  );

  const deletePage = useCallback(
    async (pageId: string, moveWidgetsToPageId?: string) => {
      if (!activeDashboardId) return;
      if (pages.length <= 1) {
        message.warning(t('cannot_delete_last_page'));
        return;
      }
      if (moveWidgetsToPageId) {
        const toMove = layout.filter(
          (l) => l.pageId === pageId || (!l.pageId && pageId === defaultPageIdRef.current)
        );
        for (const li of toMove) {
          await moveWidgetToPage(li.i, moveWidgetsToPageId);
        }
      }
      await chartService.deletePage(activeDashboardId, pageId);
      const remaining = pages.filter((p) => p.id !== pageId);
      setPages(remaining);
      if (activePageId === pageId) {
        setActivePageId(remaining[0]?.id || null);
      }
      if (defaultPageIdRef.current === pageId) {
        const next = remaining[0]?.id;
        if (next) {
          defaultPageIdRef.current = next;
          await chartService.setDefaultPage(activeDashboardId, next);
        }
      }
    },
    [activeDashboardId, pages, layout, activePageId, moveWidgetToPage, t]
  );

  return {
    runtimeFilters,
    handleRuntimeFiltersChange,
    handleCrossFilter,
    handleDrillThrough,
    handleWidgetChartClick,
    globalFiltersConfig,
    pageFiltersConfig,
    combinedFiltersConfig,
    filtersPanelOpen,
    setFiltersPanelOpen,
    filtersEditorOpen,
    setFiltersEditorOpen,
    pageFiltersEditorOpen,
    setPageFiltersEditorOpen,
    saveGlobalFilters,
    savePageFilters,
    dataSourceOptions,
    tableOptionsBySource,
    widgetScopeOptions,
    filterFieldConflicts,
    dataSourcesForFilters: dataSources,
    fetchFilterOptions,
    fetchFilterFieldStats,
    pages,
    setPages,
    activePageId,
    setActivePageId,
    defaultPageIdRef,
    initialLoadDone,
    pageWidgets,
    pageLayout,
    updatePageLayout,
    handlePageLayoutChange,
    updateChartLayout,
    moveWidgetToPage,
    deletePage,
    ...refreshControl,
  };
}
