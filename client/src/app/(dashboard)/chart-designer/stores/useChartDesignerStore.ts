import { create } from 'zustand';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';

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
  saveChart: (widget: ChartDesignerWidget, userId: string) => Promise<void>;
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

    // Auto-fetch data for the newly selected widget if it doesn't have data yet
    if (id) {
      const state = get();
      const widget = state.widgets.find((w) => w.id === id);
      if (widget && widget.dataSourceId && !widget.chartData && !widget.isLoading) {
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
    const activeProjectId = projectId || useProjectStore.getState().currentProjectId;
    if (!activeProjectId) {
      set({ widgets: [], layout: [], isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      const data = await fetchApi(`api/chart?project_id=${activeProjectId}`);

      // Safety check: if project changed while we were fetching, don't update state
      if (useProjectStore.getState().currentProjectId !== activeProjectId) {
        return;
      }

      if (data && data.success && Array.isArray(data.charts)) {
        const fetchedWidgets = data.charts.map((c: any) => ({
          id: `w_saved_${c.id}`,
          chartId: c.id,
          dashboardId: c.dashboard_id || c.dashboardId,
          title: c.name || c.title,
          chartType: c.type || c.chartType,
          chartQuery: c.config?.query || c.chartQuery || {},
          chartOptions: c.config?.options || c.chartOptions || {},
          dataSourceId: c.data_source_id || c.dataSourceId,
          userId: c.userId || userId,
          isLoading: !!(c.data_source_id || c.dataSourceId),
        }));

        const fetchedLayout = data.charts.map((c: any) => {
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

        set({ widgets: fetchedWidgets, layout: fetchedLayout });

        // Select first chart by default if nothing selected
        if (fetchedWidgets.length > 0 && !get().selectedWidgetId) {
          const firstWidgetId = fetchedWidgets[0].id;
          set({ selectedWidgetId: firstWidgetId });
          
          let usedSessionData = false;
          try {
            const tempStr = sessionStorage.getItem('temp_chart_data');
            if (tempStr) {
              const parsedData = JSON.parse(tempStr);
              get().updateWidget(firstWidgetId, { chartData: parsedData.data, isLoading: false });
              sessionStorage.removeItem('temp_chart_data');
              usedSessionData = true;
            }
          } catch (e) {
            console.error('Failed to parse temp chart data', e);
          }

          // Only fetch data for the newly selected first widget
          if (fetchedWidgets[0].dataSourceId && !usedSessionData) {
            get().fetchChartData(firstWidgetId);
          }
        } else if (get().selectedWidgetId) {
          // If we already had a selection, refresh its data
          const selectedId = get().selectedWidgetId!;
          const selectedWidget = fetchedWidgets.find((w: ChartDesignerWidget) => w.id === selectedId);
          if (selectedWidget?.dataSourceId) {
            get().fetchChartData(selectedId);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch charts:', error);
    } finally {
      // Small check again just in case
      if (useProjectStore.getState().currentProjectId === activeProjectId) {
        set({ isLoading: false });
      }
    }
  },

  saveChart: async (widget, userId) => {
    set({ isSaving: true });
    try {
      const payload: any = {
        title: widget.title,
        chartType: widget.chartType,
        dataSourceId: widget.dataSourceId,
        chartQuery: widget.chartQuery,
        chartOptions: widget.chartOptions,
        layout: get().layout.find((l) => l.i === widget.id),
      };

      if (userId) {
        payload.userId = userId;
      }

      const projectId = useProjectStore.getState().currentProjectId;
      if (!widget.chartId && !projectId) {
        console.error('No project ID to save chart');
        return;
      }

      const updateEndpoint =
        widget.chartId && widget.dashboardId
          ? `dashboards/${widget.dashboardId}/charts/${widget.chartId}`
          : widget.chartId
            ? `chart/${widget.chartId}`
            : `chart?project_id=${projectId}`;

      const response = await fetchApi(updateEndpoint, {
        method: widget.chartId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      if (response && response.id) {
        get().updateWidget(widget.id, { chartId: response.id, isLoading: false });
      }
    } catch (error) {
      console.error('Failed to save chart:', error);
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
      if (!projectId) {
        throw new Error('No project selected');
      }

      const response = await fetchApi(`chart?project_id=${projectId}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (response && response.id) {
        get().updateWidget(widget.id, { chartId: response.id, isLoading: false });
        // Now fetch actual data using the new chart ID or the execute endpoint
        await get().fetchChartData(widget.id);
      }
    } catch (error) {
      console.error('Failed to create chart:', error);
      get().updateWidget(widget.id, { isLoading: false, error: 'Failed to create chart' });
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
        get().updateWidget(widgetId, { chartData: response.data, isLoading: false });
      } else if (response && response.error) {
        get().updateWidget(widgetId, { isLoading: false, error: response.error });
      }
    } catch (error) {
      get().updateWidget(widgetId, { isLoading: false, error: 'Failed to fetch data' });
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
    const nonDataKeys = ['chartOptions', 'title', 'chartId', 'dashboardId', 'userId'];
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
