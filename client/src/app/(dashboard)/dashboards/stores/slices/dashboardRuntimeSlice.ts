import type { StateCreator } from 'zustand';
import type { ChartData } from '../../services/chartService';
import {
  refreshWidgetsBatchData,
  studioFilterConfigs,
} from '../../services/dashboardDataService';
import { runWithConcurrency, type RefreshResult } from '../../utils/dashboardRefresh';
import {
  createNextDrillState,
  drillStateAtLevel,
  type WidgetDrillState,
} from '../../utils/drillDownHelpers';
import type { RuntimeFilter } from '../../utils/filterOperators';
import type { DashboardFilter } from '@/types/dashboard';
import { isNonDataWidget, type WidgetInstance } from '../dashboardStoreTypes';
import { isRemixSnapshotWidget } from '../../utils/remixSnapshotHydration';

export type DashboardRuntimeSlice = {
  runtimeFilters: RuntimeFilter[];
  setRuntimeFilters: (filters: RuntimeFilter[]) => void;
  globalFiltersConfig: DashboardFilter[];
  setGlobalFiltersConfig: (filters: DashboardFilter[]) => void;
  pageFiltersConfig: DashboardFilter[];
  setPageFiltersConfig: (filters: DashboardFilter[]) => void;
  widgetDrillState: Record<string, WidgetDrillState>;
  setWidgetDrillState: (widgetId: string, state: WidgetDrillState | null) => void;
  drillInto: (widgetId: string, field: string, value: unknown) => Promise<void>;
  drillUp: (widgetId: string, toLevel: number) => Promise<void>;
  clearDrill: (widgetId: string) => Promise<void>;
  refreshAllChartData: (widgetIds?: string[]) => Promise<RefreshResult>;
};

type StoreWithRuntime = DashboardRuntimeSlice & {
  activeDashboardId: string | null;
  widgets: WidgetInstance[];
  dashboards: { id: string; widgets: WidgetInstance[] }[];
  partitionSeriesData: (data: ChartData, widget: WidgetInstance) => ChartData;
  fetchChartData: (widgetId: string) => Promise<void>;
};

export const createDashboardRuntimeSlice: StateCreator<
  StoreWithRuntime,
  [],
  [],
  DashboardRuntimeSlice
> = (set, get) => ({
  runtimeFilters: [],
  globalFiltersConfig: [],
  pageFiltersConfig: [],
  widgetDrillState: {},

  setRuntimeFilters: (filters) => set({ runtimeFilters: filters }),

  setWidgetDrillState: (widgetId, state) =>
    set((s) => {
      const next = { ...s.widgetDrillState };
      if (state) next[widgetId] = state;
      else delete next[widgetId];
      return { widgetDrillState: next };
    }),

  drillInto: async (widgetId, field, value) => {
    const widget = get().widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    const current = get().widgetDrillState[widgetId];
    const next = createNextDrillState(widget, current, field, value);
    if (!next) return;
    get().setWidgetDrillState(widgetId, next);
    await get().fetchChartData(widgetId);
  },

  drillUp: async (widgetId, toLevel) => {
    const current = get().widgetDrillState[widgetId];
    if (!current) return;
    const next = drillStateAtLevel(current, toLevel);
    if (next.filters.length === 0) {
      get().setWidgetDrillState(widgetId, null);
    } else {
      get().setWidgetDrillState(widgetId, next);
    }
    await get().fetchChartData(widgetId);
  },

  clearDrill: async (widgetId) => {
    get().setWidgetDrillState(widgetId, null);
    await get().fetchChartData(widgetId);
  },

  setGlobalFiltersConfig: (filters) => set({ globalFiltersConfig: filters }),

  setPageFiltersConfig: (filters) => set({ pageFiltersConfig: filters }),

  refreshAllChartData: async (widgetIds?: string[]) => {
    const state = get();
    const activeDashboardId = state.activeDashboardId;
    const { widgets } = state;
    const targets = widgetIds?.length
      ? widgets.filter((w) => widgetIds.includes(w.id))
      : widgets;
    const toRefresh = targets.filter(
      (w) => w.chartId && !isNonDataWidget(w.chartType) && !isRemixSnapshotWidget(w),
    );

    if (!toRefresh.length) {
      return { ok: 0, failed: 0, total: 0 };
    }

    if (!activeDashboardId) {
      return { ok: 0, failed: toRefresh.length, total: toRefresh.length };
    }

    set((s) => {
      const loadingIds = new Set(toRefresh.map((w) => w.id));
      const nextWidgets = s.widgets.map((w) =>
        loadingIds.has(w.id) ? { ...w, isLoading: true, error: null } : w,
      );
      const dashboards = s.dashboards.map((d) =>
        d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d,
      );
      return { widgets: nextWidgets, dashboards };
    });

    const applyBatchResults = (
      results: Array<{ widget_id?: string; chart_id: string; success: boolean; data?: ChartData; error?: string }>,
    ) => {
      const byWidget = new Map<string, (typeof results)[number]>();
      results.forEach((r) => {
        if (r.widget_id) byWidget.set(r.widget_id, r);
      });
      set((s) => {
        const refreshIds = new Set(toRefresh.map((w) => w.id));
        const nextWidgets = s.widgets.map((w) => {
          if (!refreshIds.has(w.id)) return w;
          const result = byWidget.get(w.id) ?? results.find((r) => r.chart_id === w.chartId);
          if (!result) return { ...w, isLoading: false, error: 'No result' };
          if (!result.success) {
            return { ...w, isLoading: false, error: result.error || 'Failed to fetch chart data' };
          }
          const processedData = get().partitionSeriesData(result.data!, w);
          return { ...w, chartData: processedData, isLoading: false, error: null };
        });
        const dashboards = s.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d,
        );
        return { widgets: nextWidgets, dashboards };
      });
    };

    try {
      const filterConfigs = studioFilterConfigs(state.globalFiltersConfig, state.pageFiltersConfig);
      const batch = await refreshWidgetsBatchData({
        dashboardId: activeDashboardId,
        widgets: toRefresh,
        runtimeFilters: state.runtimeFilters,
        filterConfigs,
        drillStateByWidget: state.widgetDrillState,
      });
      applyBatchResults(batch.results);
      return { ok: batch.ok, failed: batch.failed, total: batch.total };
    } catch {
      await runWithConcurrency(toRefresh, (w) => get().fetchChartData(w.id));
      const after = get().widgets;
      let ok = 0;
      let failed = 0;
      toRefresh.forEach((w) => {
        const current = after.find((x) => x.id === w.id);
        if (current?.error) failed += 1;
        else ok += 1;
      });
      return { ok, failed, total: toRefresh.length };
    }
  },
});

export type { WidgetDrillState };
