import { create } from 'zustand';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  peekPendingChartDesignerId,
  clearPendingChartDesignerSelection,
  clearPendingChartDesignerImport,
  readPendingChartDesignerImport,
  buildStandaloneChartSavePayload,
  mapApiChartToDesignerWidget,
  hydrateDesignerWidget,
  shouldFetchDesignerChartData,
} from '@/components/charts/chartDesignerBridge';
import { ApiError } from '@/utils/api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IS_ENTERPRISE_EDITION =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' || process.env.EDITION === 'enterprise';

const normalizeProjectId = (projectId?: string | number | null) => {
  if (!IS_ENTERPRISE_EDITION) return null;
  if (projectId == null) return null;
  const value = String(projectId);
  return UUID_PATTERN.test(value) ? value : null;
};

const standaloneChartEndpoint = (projectId?: string | number | null) => {
  const normalizedProjectId = normalizeProjectId(projectId);
  return normalizedProjectId ? `chart?project_id=${encodeURIComponent(normalizedProjectId)}` : 'chart';
};

export interface ChartDesignerWidget {
  id: string;
  title: string;
  chartType: string;
  chartQuery?: Record<string, any>;
  chartOptions?: Record<string, any>;
  chartId?: string;
  chartData?: any;
  isLoading?: boolean;
  error?: string | null;
  dataSourceId?: string;
  userId?: string;
  dashboardId?: string;
  lastFetchedQueryHash?: string;
}

export type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

interface ChartDesignerState {
  widgets: ChartDesignerWidget[];
  layout: LayoutItem[];
  selectedWidgetId: string | null;
  isPropertiesCollapsed: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isSidebarCollapsed: boolean;

  // Actions
  setWidgets: (widgets: ChartDesignerWidget[]) => void;
  setLayout: (layout: LayoutItem[]) => void;
  setSelectedWidgetId: (id: string | null) => void;
  setPropertiesCollapsed: (collapsed: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  addWidget: (widget: ChartDesignerWidget, layoutItem?: LayoutItem) => void;
  updateWidget: (id: string, updates: Partial<ChartDesignerWidget>) => void;
  removeWidget: (id: string) => void;
  duplicateWidget: (id: string) => void;

  // API Actions
  fetchCharts: (userId: string, projectId?: string) => Promise<void>;
  saveChart: (widget: ChartDesignerWidget, userId: string) => Promise<string | null>;
  createChartAndFetchData: (widget: ChartDesignerWidget) => Promise<void>;
  deleteChart: (widgetId: string) => Promise<void>;
  fetchChartData: (widgetId: string) => Promise<void>;
  updateChartAndFetchData: (widgetId: string, updates: Partial<ChartDesignerWidget>) => Promise<void>;
  updateChartLayout: (widgetId: string) => Promise<void>;

  clearStore: () => void;
}

export const useChartDesignerStore = create<ChartDesignerState>((set, get) => ({
  widgets: [],
  layout: [],
  selectedWidgetId: null,
  isPropertiesCollapsed: true,
  isLoading: false,
  isSaving: false,
  isSidebarCollapsed: false,

  setWidgets: (next) =>
    set((state) => ({
      widgets: typeof next === 'function' ? (next as any)(state.widgets) : next,
    })),

  setLayout: (next) =>
    set((state) => {
      const currentLayout = state.layout;
      const nextLayoutUpdates = typeof next === 'function' ? (next as any)(currentLayout) : next;

      // Merge updates into the list of all layout items
      const nextLayout = [...currentLayout];
      nextLayoutUpdates.forEach((update: LayoutItem) => {
        const index = nextLayout.findIndex((item) => item.i === update.i);
        if (index > -1) {
          nextLayout[index] = update;
        } else {
          nextLayout.push(update);
        }
      });

      // Update widgets' chartOptions.layout to keep them in sync
      const nextWidgets = state.widgets.map((w) => {
        const layoutItem = nextLayout.find((l: LayoutItem) => l.i === w.id);
        if (layoutItem) {
          return {
            ...w,
            chartOptions: {
              ...(w.chartOptions || {}),
              layout: {
                x: layoutItem.x,
                y: layoutItem.y,
                w: layoutItem.w,
                h: layoutItem.h,
              },
            },
          };
        }
        return w;
      });

      return {
        layout: nextLayout,
        widgets: nextWidgets,
      };
    }),

  setSelectedWidgetId: (id) => {
    set({ selectedWidgetId: id });

    if (id) {
      const state = get();
      const widget = state.widgets.find((w) => w.id === id);
      if (widget && shouldFetchDesignerChartData(widget) && !widget.isLoading) {
        get().fetchChartData(id);
      }
    }
  },

  setPropertiesCollapsed: (collapsed) => set({ isPropertiesCollapsed: collapsed }),

  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),

  addWidget: (widget, layoutItem) =>
    set((state) => {
      const nextWidgets = [...state.widgets, widget];
      const nextLayoutItem = layoutItem || {
        i: widget.id,
        x: 0,
        y: 0,
        w: 4,
        h: 5,
      };
      const nextLayout = [...state.layout, nextLayoutItem];
      return {
        widgets: nextWidgets,
        layout: nextLayout,
        selectedWidgetId: widget.id,
        isPropertiesCollapsed: false,
      };
    }),

  updateWidget: (id, updates) =>
    set((state) => ({
      widgets: state.widgets.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    })),

  removeWidget: (id) =>
    set((state) => {
      const selectedWidgetId = state.selectedWidgetId === id ? null : state.selectedWidgetId;
      return {
        widgets: state.widgets.filter((w) => w.id !== id),
        layout: state.layout.filter((l) => l.i !== id),
        selectedWidgetId,
        isPropertiesCollapsed: selectedWidgetId === null ? true : state.isPropertiesCollapsed,
      };
    }),

  duplicateWidget: (id) => {
    const state = get();
    const originalWidget = state.widgets.find((w) => w.id === id);
    const originalLayoutItem = state.layout.find((l) => l.i === id);

    if (!originalWidget || !originalLayoutItem) return;

    const newId = `w_designer_${Date.now()}`;
    const duplicatedWidget: ChartDesignerWidget = {
      ...originalWidget,
      id: newId,
      title: `${originalWidget.title} (Copy)`,
      chartId: undefined,
    };

    const duplicatedLayoutItem: LayoutItem = {
      ...originalLayoutItem,
      i: newId,
      y: originalLayoutItem.y + originalLayoutItem.h,
    };

    set((state) => ({
      widgets: [...state.widgets, duplicatedWidget],
      layout: [...state.layout, duplicatedLayoutItem],
      selectedWidgetId: newId,
    }));
  },

  fetchCharts: async (userId: string, projectId?: string) => {
    const activeProjectId = normalizeProjectId(projectId || useProjectStore.getState().currentProjectId);

    set({ isLoading: true });
    try {
      const data = await fetchApi(`api/${standaloneChartEndpoint(activeProjectId)}`);

      // Safety check: if project changed while we were fetching, don't update state
      if (normalizeProjectId(useProjectStore.getState().currentProjectId) !== activeProjectId) {
        return;
      }

      if (data && data.success && Array.isArray(data.charts)) {
        let fetchedWidgets: ChartDesignerWidget[] = data.charts.map((c: any) => ({
          id: `w_saved_${c.id}`,
          chartId: c.id,
          dashboardId: c.dashboard_id || c.dashboardId,
          title: c.name || c.title,
          chartType: c.type || c.chartType,
          chartQuery: c.config?.query || c.chartQuery || {},
          chartOptions: c.config?.options || c.chartOptions || {},
          dataSourceId: c.data_source_id || c.dataSourceId,
          userId: c.userId || userId,
          isLoading: false,
        }));

        let fetchedLayout: LayoutItem[] = data.charts.map((c: any) => {
          const options = c.config?.options || c.chartOptions || {};
          const savedLayout = c.layout || options.layout;
          return {
            i: `w_saved_${c.id}`,
            x: savedLayout?.x ?? 0,
            y: savedLayout?.y ?? 0,
            w: savedLayout?.w ?? 6,
            h: savedLayout?.h ?? 5,
          };
        });

        const pendingChartId = peekPendingChartDesignerId();

        if (pendingChartId) {
          let pendingWidget =
            fetchedWidgets.find((w) => String(w.chartId) === String(pendingChartId)) ?? null;

          if (!pendingWidget) {
            try {
              const chart = await fetchApi(`chart/${pendingChartId}`);
              if (chart?.id) {
                const mapped = mapApiChartToDesignerWidget(chart as Record<string, unknown>, userId);
                if (!fetchedWidgets.some((w) => String(w.chartId) === String(chart.id))) {
                  fetchedWidgets = [...fetchedWidgets, mapped.widget];
                  fetchedLayout = [...fetchedLayout, mapped.layout];
                }
                pendingWidget = mapped.widget;
              }
            } catch (fetchByIdError) {
              console.warn('[fetchCharts] pending chart fetch by id failed:', fetchByIdError);
            }
          }

          if (!pendingWidget) {
            const pendingImport = readPendingChartDesignerImport(pendingChartId);
            if (pendingImport?.widget) {
              pendingWidget = pendingImport.widget;
              if (!fetchedWidgets.some((w) => String(w.chartId) === String(pendingChartId))) {
                fetchedWidgets = [...fetchedWidgets, pendingImport.widget];
                fetchedLayout = [
                  ...fetchedLayout,
                  {
                    i: pendingImport.widget.id,
                    x: 0,
                    y: 0,
                    w: 6,
                    h: 5,
                  },
                ];
              }
            }
          }

          if (pendingWidget) {
            fetchedWidgets = fetchedWidgets.map((w) =>
              String(w.chartId) === String(pendingChartId)
                ? hydrateDesignerWidget(w, pendingChartId)
                : w,
            );
            clearPendingChartDesignerSelection();
            clearPendingChartDesignerImport();
          }
        }

        set({ widgets: fetchedWidgets, layout: fetchedLayout });

        const widgetToSelect =
          (pendingChartId
            ? fetchedWidgets.find((w) => String(w.chartId) === String(pendingChartId))
            : null) ||
          (get().selectedWidgetId
            ? fetchedWidgets.find((w) => w.id === get().selectedWidgetId)
            : null) ||
          fetchedWidgets[0] ||
          null;

        if (widgetToSelect) {
          set({ selectedWidgetId: widgetToSelect.id, isPropertiesCollapsed: false });

          if (shouldFetchDesignerChartData(widgetToSelect)) {
            get().fetchChartData(widgetToSelect.id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch charts:', error);
    } finally {
      // Small check again just in case
      if (normalizeProjectId(useProjectStore.getState().currentProjectId) === activeProjectId) {
        set({ isLoading: false });
      }
    }
  },

  saveChart: async (widget, userId) => {
    set({ isSaving: true });
    try {
      // Safe JSON serializer — strips circular refs and non-serializable values
      // (ECharts configs can contain formatter functions that cause JSON.stringify to throw)
      const safeStringify = (obj: unknown): string => {
        const seen = new WeakSet();
        return JSON.stringify(obj, (_key, value) => {
          if (typeof value === 'function') return undefined; // strip functions
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]'; // break circular refs
            seen.add(value);
          }
          return value;
        });
      };

      const projectId = useProjectStore.getState().currentProjectId;

      // EE requires a project_id — validate before sending to avoid 400/422
      if (normalizeProjectId(projectId) === null && IS_ENTERPRISE_EDITION) {
        throw new Error('Select a project before saving a chart. Choose one from the header.');
      }

      const payload = buildStandaloneChartSavePayload(widget);

      const updateEndpoint =
        widget.chartId && widget.dashboardId
          ? `dashboards/${widget.dashboardId}/charts/${widget.chartId}`
          : widget.chartId
            ? `chart/${widget.chartId}`
            : standaloneChartEndpoint(projectId);

      const bodyStr = safeStringify(payload);

      const response = await fetchApi(updateEndpoint, {
        method: widget.chartId ? 'PUT' : 'POST',
        body: bodyStr,
      });

      const chartId = response?.id ?? response?.chart?.id;
      if (chartId) {
        if (get().widgets.some((w) => w.id === widget.id)) {
          get().updateWidget(widget.id, { chartId, isLoading: false });
        }
        return String(chartId);
      }
      throw new Error('Chart save returned no id');
    } catch (error) {
      console.error('Failed to save chart:', error);
      if (error instanceof ApiError) {
        throw error;
      }
      throw error instanceof Error ? error : new Error('Failed to save chart');
    } finally {
      set({ isSaving: false });
    }
  },

  createChartAndFetchData: async (widget) => {
    get().updateWidget(widget.id, { isLoading: true, error: null });
    try {
      const payload = {
        title: widget.title,
        chartType: widget.chartType,
        dataSourceId: widget.dataSourceId,
        chartQuery: widget.chartQuery,
        chartOptions: widget.chartOptions,
      };

      const projectId = useProjectStore.getState().currentProjectId;

      const response = await fetchApi(standaloneChartEndpoint(projectId), {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (response && response.id) {
        get().updateWidget(widget.id, {
          chartId: response.id,
          isLoading: false,
          lastFetchedQueryHash: widget.lastFetchedQueryHash,
        });
        // Now fetch actual data using the new chart ID or the execute endpoint
        await get().fetchChartData(widget.id);
      }
    } catch (error) {
      console.error('Failed to create chart:', error);
      get().updateWidget(widget.id, {
        isLoading: false,
        error: 'Failed to create chart',
        lastFetchedQueryHash: widget.lastFetchedQueryHash,
      });
    }
  },

  deleteChart: async (widgetId) => {
    const widget = get().widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    try {
      if (widget.chartId) {
        const deleteEndpoint = widget.dashboardId
          ? `dashboards/${widget.dashboardId}/charts/${widget.chartId}`
          : `chart/${widget.chartId}`;
        await fetchApi(deleteEndpoint, { method: 'DELETE' });

        // IMPORTANT: Also remove from all dashboards in the dashboard store
        // to keep the Sidebar UI in sync (no refresh needed)
        try {
          const { useDashboardStore } = await import('../../dashboards/stores/useDashboardStore');
          useDashboardStore.getState().removeChartFromAllDashboards(widget.chartId);
        } catch (syncError) {
          console.error('Failed to sync chart deletion with dashboard store:', syncError);
        }
      }
      get().removeWidget(widgetId);
    } catch (error) {
      console.error('Failed to delete chart:', error);
    }
  },

  fetchChartData: async (widgetId) => {
    const widget = get().widgets.find((w) => w.id === widgetId);
    if (!widget || !widget.dataSourceId) return;

    get().updateWidget(widgetId, { isLoading: true, error: null });
    try {
      let response: any;
      if (widget.chartId && widget.dashboardId) {
        response = await fetchApi(`dashboards/${widget.dashboardId}/charts/${widget.chartId}/data`, {
          method: 'GET',
        });
      } else {
        const payload = {
          chartQuery: widget.chartQuery,
          chartType: widget.chartType,
          dataSourceId: widget.dataSourceId,
        };

        response = await fetchApi(`chart/execute`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      if (response && response.data) {
        get().updateWidget(widgetId, {
          chartData: response.data,
          isLoading: false,
          error: null,
          lastFetchedQueryHash: widget.lastFetchedQueryHash,
        });
      } else if (response && response.error) {
        get().updateWidget(widgetId, {
          isLoading: false,
          error: response.error,
          lastFetchedQueryHash: widget.lastFetchedQueryHash,
        });
      }
    } catch (error) {
      get().updateWidget(widgetId, {
        isLoading: false,
        error: 'Failed to fetch data',
        lastFetchedQueryHash: widget.lastFetchedQueryHash,
      });
    } finally {
      get().updateWidget(widgetId, { isLoading: false });
    }
  },

  updateChartAndFetchData: async (widgetId, updates) => {
    const widget = get().widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    // 1. Update local state immediately
    get().updateWidget(widgetId, updates);
    const updatedWidget = { ...widget, ...updates };

    // 2. If it's a saved chart, sync to DB
    if (updatedWidget.chartId) {
      try {
        const payload = {
          title: updatedWidget.title,
          chartType: updatedWidget.chartType,
          dataSourceId: updatedWidget.dataSourceId,
          chartQuery: updatedWidget.chartQuery,
          chartOptions: updatedWidget.chartOptions,
          layout: get().layout.find((l) => l.i === widgetId),
        };

        const updateEndpoint = updatedWidget.dashboardId
          ? `dashboards/${updatedWidget.dashboardId}/charts/${updatedWidget.chartId}`
          : `chart/${updatedWidget.chartId}`;

        await fetchApi(updateEndpoint, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error('Failed to sync chart to DB:', e);
      }
    }

    // 3. Fetch fresh data if needed (if query or data source changed)
    const nonDataKeys = ['chartOptions', 'title', 'chartId', 'dashboardId', 'userId', 'lastFetchedQueryHash'];
    const skipDataFetch = Object.keys(updates).every((key) => nonDataKeys.includes(key));
    
    if (updatedWidget.dataSourceId && !skipDataFetch) {
      await get().fetchChartData(widgetId);
    }
  },

  updateChartLayout: async (widgetId: string) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      const layoutItem = state.layout.find((l) => l.i === widgetId);

      if (!widget?.chartId || !layoutItem) return;

      const payload = {
        title: widget.title,
        chartType: widget.chartType,
        dataSourceId: widget.dataSourceId,
        chartQuery: widget.chartQuery,
        chartOptions: widget.chartOptions,
        layout: {
          x: layoutItem.x,
          y: layoutItem.y,
          w: layoutItem.w,
          h: layoutItem.h,
        },
      };

      const updateEndpoint = widget.dashboardId
        ? `dashboards/${widget.dashboardId}/charts/${widget.chartId}`
        : `chart/${widget.chartId}`;

      await fetchApi(updateEndpoint, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('Failed to update chart layout:', error);
    }
  },

  clearStore: () =>
    set({
      widgets: [],
      layout: [],
      selectedWidgetId: null,
      isPropertiesCollapsed: true,
      isSidebarCollapsed: false,
      isLoading: false,
      isSaving: false,
    }),
}));
