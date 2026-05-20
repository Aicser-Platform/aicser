import { create } from 'zustand';
import type React from 'react';
import { chartService, type Chart, type ChartData } from '../services/chartService';
import { useProjectStore } from '@/stores/useProjectStore';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

export type WidgetType = 'pie' | 'line' | 'area' | 'bar' | 'table' | 'scatter' | 'funnel' | 'heatmap' | 'stat' | 'text';

export type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WidgetInstance = {
  id: string;
  dataSourceId?: string;
  title: string;
  chartType: WidgetType;
  chartQuery?: {
    x?: string;
    aggregate?: boolean;
    yMetric?: 'count' | 'sum' | 'none' | 'distinct_count' | 'avg' | 'min' | 'max';
    xMetrics?: { field: string; aggregation: string }[];
    yMetrics?: { field: string; aggregation: string }[];
    yMetricsSecondary?: { field: string; aggregation: string }[];
    y?: string;
    legend?: string;
    sortBy?: string;
    filters?: {
      field: string;
      operator: string;
      value: any;
      type: 'simple' | 'sql';
      sql?: string;
    }[];
    metricFilters?: {
      field: string;
      aggregation: string;
      operator: string;
      value: any;
    }[];
    tableName?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    seriesLimit?: number;
  };
  chartOptions?: any;
  chartId?: string;
  chartData?: ChartData;
  isLoading?: boolean;
  error?: string | null;
  lastFetchedQueryHash?: string;
};

export interface Dashboard {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
}

interface DashboardState {
  dashboards: Dashboard[];
  isLoadingDashboards: boolean;
  hasLoadedDashboards: boolean;
  dashboardError: string | null;
  activeDashboardId: string | null;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  selectedWidgetId: string | null;
  isSidebarCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  isSaving: boolean;
  activeLeftTab: string;
  setWidgets: React.Dispatch<React.SetStateAction<WidgetInstance[]>>;
  setLayout: React.Dispatch<React.SetStateAction<LayoutItem[]>>;
  setSelectedWidgetId: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setPropertiesCollapsed: (collapsed: boolean) => void;
  setActiveLeftTab: (tab: string) => void;
  setSaving: (saving: boolean) => void;
  isFullscreen: boolean;
  setIsFullscreen: (full: boolean) => void;
  fetchDashboards: () => Promise<void>;

  // Dashboard management
  addDashboard: (name?: string) => Promise<string>;
  removeDashboard: (id: string) => Promise<void>;
  setActiveDashboardId: (id: string) => void;
  updateDashboardName: (id: string, name: string) => Promise<void>;

  addWidget: (widget: WidgetInstance, layoutItem: LayoutItem) => void;
  removeWidget: (id: string) => void;
  duplicateWidget: (id: string) => Promise<void>;
  updateWidget: (id: string, updates: Partial<WidgetInstance>) => void;
  createChartAndFetchData: (widget: WidgetInstance) => Promise<void>;
  updateChartAndFetchData: (widgetId: string, updates: Partial<WidgetInstance>) => Promise<void>;
  deleteChart: (widgetId: string) => Promise<void>;
  fetchChartData: (widgetId: string) => Promise<void>;
  updateChartLayout: (widgetId: string) => Promise<void>;
  removeChartFromAllDashboards: (chartId: string) => void;
  partitionSeriesData: (data: ChartData, widget: WidgetInstance) => ChartData;
  copyWidgetToDashboard: (
    widget: WidgetInstance,
    layoutItem: LayoutItem | undefined,
    targetDashboardId: string
  ) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  dashboards: [],
  isLoadingDashboards: false,
  hasLoadedDashboards: false,
  dashboardError: null,
  activeDashboardId: null,
  widgets: [],
  layout: [],
  selectedWidgetId: null,
  isSidebarCollapsed: false,
  isPropertiesCollapsed: true,
  isSaving: false,
  activeLeftTab: 'library',
  isFullscreen: false,

  partitionSeriesData: (data, widget) => {
    // If backend already provided separate series, just use them
    if (data.secondarySeries && data.secondarySeries.length > 0) return data;

    const cartesianTypes = ['line', 'bar'];
    if (!cartesianTypes.includes(widget.chartType) || !data.series || data.series.length === 0) return data;

    const yMetricsCount = widget.chartQuery?.yMetrics?.length || 0;
    const secondaryMetricsCount = widget.chartQuery?.yMetricsSecondary?.length || 0;

    if (secondaryMetricsCount === 0) return data;

    const series = data.series.slice(0, yMetricsCount);
    const secondarySeries = data.series.slice(yMetricsCount, yMetricsCount + secondaryMetricsCount);

    return {
      ...data,
      series,
      secondarySeries,
    };
  },

  setWidgets: (next) =>
    set((state) => {
      const widgets =
        typeof next === 'function' ? (next as (prev: WidgetInstance[]) => WidgetInstance[])(state.widgets) : next;
      const dashboards = state.dashboards.map((d) => (d.id === state.activeDashboardId ? { ...d, widgets } : d));
      return { widgets, dashboards };
    }),

  setLayout: (next) =>
    set((state) => {
      const layout = typeof next === 'function' ? (next as (prev: LayoutItem[]) => LayoutItem[])(state.layout) : next;
      const dashboards = state.dashboards.map((d) => (d.id === state.activeDashboardId ? { ...d, layout } : d));

      return { layout, dashboards };
    }),

  setSelectedWidgetId: (id) => set({ selectedWidgetId: id }),
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  setPropertiesCollapsed: (collapsed) => set({ isPropertiesCollapsed: collapsed }),
  setActiveLeftTab: (tab) => set({ activeLeftTab: tab }),
  setSaving: (saving: boolean) => set({ isSaving: saving }),

  copyWidgetToDashboard: async (widget, layoutItem, targetDashboardId) => {
    const state = get();

    // Find the target dashboard to calculate a safe placement position
    const targetDashboard = state.dashboards.find((d) => String(d.id) === String(targetDashboardId));
    const targetLayout = targetDashboard?.layout ?? [];

    // Calculate the bottom-most Y position so the widget is placed below all existing widgets
    const safeY = targetLayout.length > 0 ? Math.max(...targetLayout.map((l) => l.y + l.h)) : 0;

    // Preserve the original size (w/h) but place at a safe, non-overlapping position
    const safeW = layoutItem?.w ?? 6;
    const safeH = layoutItem?.h ?? 5;

    // Build the payload for the API — send the safe layout position
    const payload = {
      dataSourceId: widget.dataSourceId || null,
      chartType: widget.chartType,
      title: `${widget.title || 'Untitled'} (Copy)`,
      chartQuery: widget.chartQuery || {},
      chartOptions: widget.chartOptions || {},
      layout: { x: 0, y: safeY, w: safeW, h: safeH },
    };

    // Create the chart on the backend
    const newChart = await chartService.createChart(targetDashboardId, payload);

    // Build new widget and layout item using the safe position
    const newWidgetId = `widget-${newChart.id}`;
    const newWidget: WidgetInstance = {
      id: newWidgetId,
      chartId: newChart.id,
      dataSourceId: newChart.dataSourceId ?? undefined,
      title: newChart.title || '',
      chartType: (newChart.chartType as WidgetType) || 'bar',
      chartQuery: newChart.chartQuery,
      chartOptions: newChart.chartOptions,
      chartData: undefined,
      isLoading: false,
      error: null,
    };

    const newLayoutItem: LayoutItem = {
      i: newWidgetId,
      x: 0,
      y: safeY,
      w: safeW,
      h: safeH,
    };

    // Optimistically update only the target dashboard — all other dashboards are untouched
    const updatedDashboards = state.dashboards.map((d) => {
      if (String(d.id) !== String(targetDashboardId)) return d;
      return {
        ...d,
        widgets: [...d.widgets, newWidget],
        layout: [...d.layout, newLayoutItem],
      };
    });

    // If the target is already the active dashboard, also update the flat stores
    const isTargetActive = String(state.activeDashboardId) === String(targetDashboardId);
    set({
      dashboards: updatedDashboards,
      ...(isTargetActive
        ? {
            widgets: [...state.widgets, newWidget],
            layout: [...state.layout, newLayoutItem],
          }
        : {}),
    });

    // Fetch chart data for the new widget if it has a data source
    if (newChart.dataSourceId) {
      get().fetchChartData(newWidgetId);
    }

    // Switch the active view to the target dashboard
    get().setActiveDashboardId(targetDashboardId);
  },

  fetchDashboards: async () => {
    const { currentProjectId } = useProjectStore.getState();
    const projectId = isEnterpriseEdition ? currentProjectId : undefined;

    set({ isLoadingDashboards: true, dashboardError: null });
    try {
      const dashboardsResponse = await chartService.listDashboards(projectId ?? undefined);

      // Load dashboards with their charts
      const dashboards: Dashboard[] = await Promise.all(
        dashboardsResponse.map(async (d) => {
          try {
            // Fetch charts for this dashboard
            const charts = await chartService.listCharts(d.id);

            // Convert charts to widgets and extract layout
            const widgets: WidgetInstance[] = [];
            const layout: LayoutItem[] = [];

            charts.forEach((chart: any) => {
              const widgetId = `widget-${chart.id}`;

              widgets.push({
                id: widgetId,
                chartId: chart.id,
                dataSourceId: chart.dataSourceId,
                title: chart.title || '',
                chartType: (chart.chartType as WidgetType) || 'bar',
                chartQuery: chart.chartQuery,
                chartOptions: chart.chartOptions,
                chartData: undefined,
                isLoading: false,
                error: null,
              });

              // Extract layout if it exists, otherwise use defaults
              const chartLayout = chart.layout || {};
              layout.push({
                i: widgetId,
                x: chartLayout.x ?? 0,
                y: chartLayout.y ?? 0,
                w: chartLayout.w ?? 4,
                h: chartLayout.h ?? 5,
              });
            });

            return { id: d.id, name: d.title, widgets, layout };
          } catch (error) {
            console.error(`Failed to load charts for dashboard ${d.id}:`, error);
            return { id: d.id, name: d.title, widgets: [], layout: [] };
          }
        })
      );

      if (dashboards.length === 0) {
        set({
          dashboards: [],
          activeDashboardId: null,
          widgets: [],
          layout: [],
          isLoadingDashboards: false,
          hasLoadedDashboards: true,
          dashboardError: null,
        });
        return;
      }

      const state = get();
      const currentActiveId = state.activeDashboardId;
      const targetDash = dashboards.find((d) => String(d.id) === String(currentActiveId)) || dashboards[0];
      const nextActiveId = targetDash.id;

      set({
        dashboards,
        isLoadingDashboards: false,
        hasLoadedDashboards: true,
        dashboardError: null,
        activeDashboardId: nextActiveId,
        widgets: targetDash.widgets,
        layout: targetDash.layout,
      });

      // Fetch chart data for all widgets in the active dashboard that have chartId
      if (targetDash.widgets.length > 0) {
        const widgetsToFetch = targetDash.widgets.filter((w) => w.chartId);
        for (const widget of widgetsToFetch) {
          get().fetchChartData(widget.id);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch dashboards';
      console.error('Failed to fetch dashboards:', error);
      set({
        isLoadingDashboards: false,
        hasLoadedDashboards: true,
        dashboardError: errorMessage,
      });
    }
  },

  addDashboard: async (name) => {
    const { currentProjectId } = useProjectStore.getState();
    const projectId = isEnterpriseEdition ? currentProjectId : undefined;

    try {
      const dashboard = await chartService.createDashboard(
        {
          title: name || `Dashboard ${get().dashboards.length + 1}`,
        },
        projectId ?? undefined
      );

      const newDash: Dashboard = { id: dashboard.id, name: dashboard.title, widgets: [], layout: [] };

      set((state) => ({ dashboards: [...state.dashboards, newDash] }));
      get().setActiveDashboardId(dashboard.id);
      return dashboard.id;
    } catch (error) {
      console.error('Failed to create dashboard:', error);
      return '';
    }
  },

  removeDashboard: async (id) => {
    try {
      const state = get();
      const targetDash = state.dashboards.find((d) => String(d.id) === String(id));

      // 1. Explicitly delete all charts inside this dashboard first if they exist
      // This satisfies the user's requirement to ensure charts are removed too.
      if (targetDash && targetDash.widgets.length > 0) {
        const chartDeletionPromises = targetDash.widgets
          .filter((w) => w.chartId)
          .map((w) => chartService.deleteChart(id, w.chartId!));

        try {
          await Promise.all(chartDeletionPromises);
        } catch (chartErr) {
          console.warn(`Some charts failed to delete for dashboard ${id}:`, chartErr);
          // Continue with dashboard deletion regardless
        }
      }

      // 2. Delete the dashboard itself
      await chartService.deleteDashboard(id);

      const { dashboards, activeDashboardId } = get();
      const newDashboards = dashboards.filter((d) => String(d.id) !== String(id));
      let nextActiveId: string | null = activeDashboardId;

      const isDeletingActive = String(activeDashboardId) === String(id);

      if (isDeletingActive) {
        nextActiveId = newDashboards.length > 0 ? newDashboards[0].id : null;
      }

      // Update the list first
      set({ dashboards: newDashboards });

      // Handle transitioning to the next dashboard or clearing state
      if (nextActiveId) {
        get().setActiveDashboardId(nextActiveId);
      } else if (isDeletingActive) {
        // If we deleted the active one and none are left, clear active state
        set({
          activeDashboardId: null,
          widgets: [],
          layout: [],
          selectedWidgetId: null,
        });
      }
    } catch (error) {
      console.error('Failed to remove dashboard:', error);
      throw error;
    }
  },

  setActiveDashboardId: (id) => {
    const state = get();
    if (state.activeDashboardId === id) return;

    // Save current active state to dashboards array first
    const updatedDashboards = state.dashboards.map((d) =>
      d.id === state.activeDashboardId ? { ...d, widgets: state.widgets, layout: state.layout } : d
    );

    const targetDash = updatedDashboards.find((d) => d.id === id);
    if (!targetDash) return;

    set({
      activeDashboardId: id,
      dashboards: updatedDashboards,
      widgets: targetDash.widgets,
      layout: targetDash.layout,
      selectedWidgetId: null,
      isPropertiesCollapsed: true,
    });

    // Fetch chart data for all widgets that have chartId
    const widgetsToFetch = targetDash.widgets.filter((w) => w.chartId);
    for (const widget of widgetsToFetch) {
      get().fetchChartData(widget.id);
    }
  },

  updateDashboardName: async (id, name) => {
    try {
      await chartService.updateDashboard(id, { title: name });
      set((state) => ({
        dashboards: state.dashboards.map((d) => (d.id === id ? { ...d, name } : d)),
      }));
    } catch (error) {
      console.error('Failed to update dashboard name:', error);
    }
  },

  addWidget: (widget, layoutItem) =>
    set((state) => {
      const widgets = [...state.widgets, widget];
      const layout = [...state.layout, layoutItem];
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, widgets, layout } : d
      );
      return { widgets, layout, dashboards, selectedWidgetId: widget.id, isPropertiesCollapsed: false };
    }),
  removeWidget: (id) =>
    set((state) => {
      const widgets = state.widgets.filter((w) => w.id !== id);
      const layout = state.layout.filter((l) => l.i !== id);
      const selectedWidgetId = state.selectedWidgetId === id ? null : state.selectedWidgetId;
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, widgets, layout } : d
      );
      return { widgets, layout, selectedWidgetId, dashboards };
    }),

  removeChartFromAllDashboards: (chartId) =>
    set((state) => {
      const dashboards = state.dashboards.map((d) => ({
        ...d,
        widgets: d.widgets.filter((w) => String(w.chartId) !== String(chartId)),
        layout: d.layout.filter((l) => {
          // Find if this layout item belongs to a widget that was removed
          const widgetToRemove = d.widgets.find((w) => String(w.chartId) === String(chartId) && w.id === l.i);
          return !widgetToRemove;
        }),
      }));

      // Also remove from active widgets if it belongs to current dashboard
      const widgets = state.widgets.filter((w) => String(w.chartId) !== String(chartId));
      const layout = state.layout.filter((l) => {
        const widgetToRemove = state.widgets.find((w) => String(w.chartId) === String(chartId) && w.id === l.i);
        return !widgetToRemove;
      });

      return { dashboards, widgets, layout };
    }),

  duplicateWidget: async (id: string) => {
    const state = get();
    const originalWidget = state.widgets.find((w) => w.id === id);
    const originalLayoutItem = state.layout.find((l) => l.i === id);
    const activeDashboardId = state.activeDashboardId;

    if (!originalWidget || !originalLayoutItem || !activeDashboardId) {
      console.error('Missing required state for duplication');
      return;
    }

    // Smart title generation for duplicates
    const generateDuplicateTitle = (originalTitle: string, existingWidgets: WidgetInstance[]): string => {
      const copyRegex = / \(Copy( \d+)?\)$/;
      const baseTitle = originalTitle.replace(copyRegex, '');
      const existingTitles = existingWidgets.map((w) => w.title).filter((title) => title.startsWith(baseTitle));

      let maxCopyNumber = 0;
      existingTitles.forEach((title) => {
        if (title === `${baseTitle} (Copy)`) {
          maxCopyNumber = Math.max(maxCopyNumber, 1);
        } else {
          const match = title.match(
            new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(Copy (\\d+)\\)$`)
          );
          if (match) {
            maxCopyNumber = Math.max(maxCopyNumber, parseInt(match[1], 10));
          }
        }
      });

      return maxCopyNumber === 0 ? `${baseTitle} (Copy)` : `${baseTitle} (Copy ${maxCopyNumber + 1})`;
    };

    const newTitle = generateDuplicateTitle(originalWidget.title, state.widgets);
    const newLayout = {
      x: Math.min(originalLayoutItem.x + 1, 11),
      y: originalLayoutItem.y + originalLayoutItem.h + 1,
      w: originalLayoutItem.w,
      h: originalLayoutItem.h,
    };

    try {
      // Create the new chart on the backend
      const payload = {
        dataSourceId: originalWidget.dataSourceId || null,
        chartType: originalWidget.chartType,
        title: newTitle,
        chartQuery: originalWidget.chartQuery || {},
        chartOptions: originalWidget.chartOptions || {},
        layout: newLayout,
      };

      const newChart = await chartService.createChart(activeDashboardId, payload);

      // Create duplicated widget for client-side use
      const newWidgetId = `widget-${newChart.id}`;
      const duplicatedWidget: WidgetInstance = {
        id: newWidgetId,
        chartId: newChart.id,
        dataSourceId: newChart.dataSourceId ?? undefined,
        title: newChart.title || 'Untitled Chart',
        chartType: (newChart.chartType as WidgetType) || 'bar',
        chartQuery: newChart.chartQuery,
        chartOptions: newChart.chartOptions,
        chartData: undefined,
        isLoading: false,
        error: null,
      };

      const duplicatedLayoutItem: LayoutItem = {
        i: newWidgetId,
        x: newLayout.x,
        y: newLayout.y,
        w: newLayout.w,
        h: newLayout.h,
      };

      // Update state with new widget and layout
      set((state) => {
        const widgets = [...state.widgets, duplicatedWidget];
        const layout = [...state.layout, duplicatedLayoutItem];
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets, layout } : d
        );
        return { widgets, layout, dashboards, selectedWidgetId: newWidgetId };
      });

      // Fetch chart data for the new duplicate
      if (newChart.dataSourceId) {
        get().fetchChartData(newWidgetId);
      }
    } catch (err) {
      console.error('Failed to persist duplicated widget:', err);
      throw err; // Allow component to show error message
    }
  },

  updateWidget: (id, updates) =>
    set((state) => {
      const widgets = state.widgets.map((w) => (w.id === id ? { ...w, ...updates } : w));
      const dashboards = state.dashboards.map((d) => (d.id === state.activeDashboardId ? { ...d, widgets } : d));
      return { widgets, dashboards };
    }),

  createChartAndFetchData: async (widget: WidgetInstance) => {
    try {
      // Ensure chartQuery has default values
      const chartQuery = {
        ...widget.chartQuery,
        x: widget.chartQuery?.x || '',
        yMetric: (widget.chartQuery?.yMetric || 'count') as 'count' | 'sum',
        yMetrics: widget.chartQuery?.yMetrics || [],
        yMetricsSecondary: widget.chartQuery?.yMetricsSecondary || [],
        y: widget.chartQuery?.y || '',
        legend: widget.chartQuery?.legend || '',
        sortBy: widget.chartQuery?.sortBy || 'x', 
        limit: widget.chartQuery?.limit,
        seriesLimit: widget.chartQuery?.seriesLimit,
        sortOrder: widget.chartQuery?.sortOrder,
      };

      // Find the layout item for this widget
      const state = get();
      const layoutItem = state.layout.find((l) => l.i === widget.id);

      const createPayload = {
        dataSourceId: widget.dataSourceId || null, // Allow null for text widgets
        chartType: widget.chartType,
        title: widget.title,
        chartQuery,
        chartOptions: widget.chartOptions,
        ...(layoutItem && {
          layout: { x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h },
        }),
      };

      const activeDashboardId = get().activeDashboardId;
      if (!activeDashboardId) throw new Error('No active dashboard');

      set((state) => {
        const nextWidgets = state.widgets.map((w) => (w.id === widget.id ? { ...w, isLoading: true, error: null } : w));
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      const chart = await chartService.createChart(activeDashboardId, createPayload);

      // For text widgets, we don't need to fetch data - just create the chart entry and we're done
      const isTextWidget = widget.chartType === 'text';

      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widget.id ? { ...w, chartId: chart.id, isLoading: false } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      // Skip data fetching for text widgets
      if (isTextWidget) {
        return;
      }

      // Fetch data for charts that need data
      try {
        const response = await chartService.executeChart(activeDashboardId, chart.id);
        const { data } = response;
        const processedData = get().partitionSeriesData(data, widget);

        set((state) => {
          const nextWidgets = state.widgets.map((w) => (w.id === widget.id ? { ...w, chartData: processedData } : w));
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
      } catch (dataError) {
        console.error('Failed to fetch data for chart:', dataError);
        // Don't mark as error, chart is created successfully
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create chart';
      console.error('[createChartAndFetchData] Error:', errorMessage);
      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widget.id ? { ...w, isLoading: false, error: errorMessage } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });
    }
  },

  updateChartAndFetchData: async (widgetId: string, updates: Partial<WidgetInstance>) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      if (!widget || !widget.chartId) return;

      // Build complete chartQuery with defaults
      const mergedChartQuery = { ...widget.chartQuery, ...updates.chartQuery };
      const chartQuery = {
        ...mergedChartQuery,
        x: mergedChartQuery.x || '',
        yMetric: (mergedChartQuery.yMetric || 'count') as 'count' | 'sum',
        yMetrics: mergedChartQuery.yMetrics || [],
        yMetricsSecondary: mergedChartQuery.yMetricsSecondary || [],
        y: mergedChartQuery.y || '',
        legend: mergedChartQuery.legend || '',
        sortBy: mergedChartQuery.sortBy || 'x',
        limit: mergedChartQuery.limit,
        seriesLimit: mergedChartQuery.seriesLimit,
        sortOrder: mergedChartQuery.sortOrder,
      };

      // Merge chartOptions properly - combine existing with updates
      const mergedChartOptions = { ...widget.chartOptions, ...updates.chartOptions };

      const updatePayload = {
        dataSourceId: updates.dataSourceId || widget.dataSourceId,
        chartType: updates.chartType || widget.chartType,
        title: updates.title || widget.title,
        chartQuery,
        chartOptions: mergedChartOptions,
      };

      const activeDashboardId = state.activeDashboardId;
      if (!activeDashboardId) throw new Error('No active dashboard');

      // Skip data fetch if only descriptive/UI properties changed
      const nonDataKeys = ['chartOptions', 'title', 'chartId', 'dashboardId', 'userId'];
      const skipDataFetch = Object.keys(updates).every((key) => nonDataKeys.includes(key));

      if (skipDataFetch) {
        // Persist chartOptions to backend, update local state, no loading, no data fetch
        await chartService.updateChart(activeDashboardId, widget.chartId, updatePayload);
        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widgetId ? { ...w, ...updates, chartOptions: mergedChartOptions } : w
          );
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
        return;
      }

      set((state) => {
        const nextWidgets = state.widgets.map((w) => (w.id === widgetId ? { ...w, isLoading: true, error: null } : w));
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      const updatedChart = await chartService.updateChart(activeDashboardId, widget.chartId, updatePayload);

      // For text widgets, we don't need to fetch data - just update the widget with the new options
      const isTextWidget = (updates.chartType || widget.chartType) === 'text';

      if (isTextWidget) {
        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widgetId ? { ...w, ...updates, chartOptions: mergedChartOptions, isLoading: false } : w
          );
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
      } else {
        // Fetch updated data for charts that need data
        const { data } = await chartService.executeChart(activeDashboardId, updatedChart.id);
        const processedData = get().partitionSeriesData(data, { ...widget, ...updates });

        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widgetId ? { ...w, ...updates, chartData: processedData, isLoading: false } : w
          );
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update chart';
      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widgetId ? { ...w, isLoading: false, error: errorMessage } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });
    }
  },

  deleteChart: async (widgetId: string) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      const activeDashboardId = state.activeDashboardId;

      if (!activeDashboardId) {
        throw new Error('No active dashboard');
      }

      if (!widget) {
        throw new Error('Widget not found');
      }

      if (!widget.chartId) {
        console.warn(`Widget ${widgetId} has no chartId, skipping backend deletion`);
        get().removeWidget(widgetId);
        return;
      }

      // Call backend to delete the chart
      await chartService.deleteChart(activeDashboardId, widget.chartId);

      // Remove widget globally from all dashboards in client state
      get().removeChartFromAllDashboards(widget.chartId);

      // Sync with Chart Designer store if needed
      try {
        const { useChartDesignerStore } = await import('../../chart-designer/stores/useChartDesignerStore');
        const designerWidgets = useChartDesignerStore.getState().widgets;
        const matchingDesignerWidget = designerWidgets.find((w) => String(w.chartId) === String(widget.chartId));
        if (matchingDesignerWidget) {
          useChartDesignerStore.getState().removeWidget(matchingDesignerWidget.id);
        }
      } catch (syncError) {
        // Silently ignore if ChartDesignerStore isn't initialized or accessible
      }

      console.log(`Chart ${widget.chartId} deleted successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete chart';
      console.error('[deleteChart] Error:', errorMessage);

      // Update error state for the widget
      set((state) => ({
        widgets: state.widgets.map((w) => (w.id === widgetId ? { ...w, error: errorMessage } : w)),
      }));

      // Re-throw error so calling code can handle it
      throw error;
    }
  },

  fetchChartData: async (widgetId: string) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      const activeDashboardId = state.activeDashboardId;
      if (!activeDashboardId) throw new Error('No active dashboard');
      if (!widget || !widget.chartId) return;

      set((state) => {
        const nextWidgets = state.widgets.map((w) => (w.id === widgetId ? { ...w, isLoading: true, error: null } : w));
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      const { data } = await chartService.executeChart(activeDashboardId, widget.chartId);
      const processedData = get().partitionSeriesData(data, widget);

      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widgetId ? { ...w, chartData: processedData, isLoading: false } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch chart data';
      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widgetId ? { ...w, isLoading: false, error: errorMessage } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });
    }
  },

  updateChartLayout: async (widgetId: string) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      const layoutItem = state.layout.find((l) => l.i === widgetId);
      const activeDashboardId = state.activeDashboardId;

      if (!activeDashboardId || !widget?.chartId || !layoutItem) return;

      await chartService.updateChartLayout(activeDashboardId, widget.chartId, {
        x: layoutItem.x,
        y: layoutItem.y,
        w: layoutItem.w,
        h: layoutItem.h,
      });
    } catch (error) {
      console.error('Failed to update chart layout:', error);
    }
  },
  setIsFullscreen: (full: boolean) => set({ isFullscreen: full }),
}));
