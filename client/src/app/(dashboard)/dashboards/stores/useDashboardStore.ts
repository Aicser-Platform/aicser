import { create } from 'zustand';
import type React from 'react';
import { chartService, type Chart, type ChartData } from '../services/chartService';
import {
  fetchWidgetChartData,
  studioFilterConfigs,
} from '../services/dashboardDataService';
import { useProjectStore } from '@/stores/useProjectStore';
import { mergePageLayout } from '../utils/pageLayoutHelpers';
import type { DashboardFilter } from '@/types/dashboard';
import { readStudioMode } from '../utils/studioModeStorage';
import { partitionSeriesData } from '../utils/chartDataProcessing';
import { runWithConcurrency, type RefreshResult } from '../utils/dashboardRefresh';
import type { WidgetDrillState } from '../utils/drillDownHelpers';
import { sanitizeLayoutItem, maxLayoutY } from '../utils/layoutSanitize';
import {
  hydrateRemixWidget,
  isRemixSnapshotWidget,
} from '../utils/remixSnapshotHydration';
import { getColorsFromPalette } from '../widgets/WidgetRendererConfig';
import { isWidgetPaletteInherited, WIDGET_PALETTE_INHERIT } from '../utils/chartPaletteCatalog';
import {
  buildStarterDashboardWidgets,
  type StarterLayoutKind,
} from '../utils/dashboardStarterLayouts';
import { formatApiValidationError, isValidUuid } from '@/utils/validationErrorMessage';
import {
  type WidgetType,
  type LayoutItem,
  type WidgetInstance,
  type Dashboard,
  type StudioMode,
  type DashboardVersion,
  scopedFiltersForWidget,
  isNonDataWidget,
  type RuntimeFilter,
} from './dashboardStoreTypes';
import { createDashboardRuntimeSlice, type DashboardRuntimeSlice } from './slices/dashboardRuntimeSlice';
import { createDashboardUiSlice, type DashboardUiSlice } from './slices/dashboardUiSlice';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

export type {
  WidgetType,
  LayoutItem,
  WidgetInstance,
  Dashboard,
  StudioMode,
  DashboardVersion,
  RuntimeFilter,
};
export { scopedFiltersForWidget, isNonDataWidget };

type ChartWithLayout = Chart & {
  layout?: { x?: number; y?: number; w?: number; h?: number; page_id?: string | null };
};

/** Map backend chart records to studio widgets + grid layout (page assignment included). */
function chartsToWidgetsAndLayout(charts: ChartWithLayout[]): {
  widgets: WidgetInstance[];
  layout: LayoutItem[];
} {
  const widgets: WidgetInstance[] = [];
  const layout: LayoutItem[] = [];

  charts.forEach((chart) => {
    const widgetId = `widget-${chart.id}`;

    const baseWidget: WidgetInstance = {
      id: widgetId,
      chartId: chart.id,
      dataSourceId: chart.dataSourceId ?? undefined,
      title: chart.title || '',
      chartType: (chart.chartType as WidgetType) || 'bar',
      chartQuery: chart.chartQuery,
      chartOptions: chart.chartOptions,
      chartData: undefined,
      isLoading: false,
      error: null,
    };

    widgets.push(hydrateRemixWidget(baseWidget));

    const chartLayout = chart.layout || {};
    layout.push({
      i: widgetId,
      x: chartLayout.x ?? 0,
      y: chartLayout.y ?? 0,
      w: chartLayout.w ?? 4,
      h: chartLayout.h ?? 5,
      ...(chartLayout.page_id ? { pageId: String(chartLayout.page_id) } : {}),
    });
  });

  return { widgets, layout };
}

// ─── Version history (named snapshots, stored in localStorage) ────────────────
const MAX_VERSIONS = 20;
const VERSION_STORAGE_KEY = (dashId: string) => `aicser_dash_versions_${dashId}`;

function loadVersions(dashboardId: string): DashboardVersion[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(VERSION_STORAGE_KEY(dashboardId));
    return raw ? (JSON.parse(raw) as DashboardVersion[]) : [];
  } catch {
    return [];
  }
}

function persistVersions(dashboardId: string, versions: DashboardVersion[]) {
  try {
    localStorage.setItem(VERSION_STORAGE_KEY(dashboardId), JSON.stringify(versions));
  } catch {}
}

// ─── History snapshot for undo/redo ───────────────────────────────────────────
type HistorySnapshot = { widgets: WidgetInstance[]; layout: LayoutItem[] };
const MAX_HISTORY = 30;
// Module-level stacks (outside Zustand — avoids re-renders on every push)
const _undoStack: HistorySnapshot[] = [];
const _redoStack: HistorySnapshot[] = [];

function pushUndo(snap: HistorySnapshot) {
  if (_undoStack.length >= MAX_HISTORY) _undoStack.shift();
  _undoStack.push(snap);
  _redoStack.length = 0; // any new action clears redo
}

// Selectors exported as hooks
export const useCanUndo = () => useDashboardStore((s) => s._historyVersion > 0 && _undoStack.length > 0);
export const useCanRedo = () => useDashboardStore((s) => s._historyVersion >= 0 && _redoStack.length > 0);
export const useUndo = () => useDashboardStore((s) => s.historyUndo);
export const useRedo = () => useDashboardStore((s) => s.historyRedo);

/** Call before any layout mutation to capture an undoable snapshot. */
export function pushUndoSnapshot() {
  const { widgets, layout } = useDashboardStore.getState();
  pushUndo({ widgets, layout });
  useDashboardStore.setState((state) => ({ _historyVersion: state._historyVersion + 1 }));
}

interface DashboardState extends DashboardUiSlice, DashboardRuntimeSlice {
  dashboards: Dashboard[];
  isLoadingDashboards: boolean;
  hasLoadedDashboards: boolean;
  dashboardError: string | null;
  activeDashboardId: string | null;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  layoutCollabTs?: number;
  selectedWidgetId: string | null;
  /** Bumped on every history mutation so canUndo/canRedo selectors re-run */
  _historyVersion: number;
  historyUndo: () => void;
  historyRedo: () => void;
  setWidgets: React.Dispatch<React.SetStateAction<WidgetInstance[]>>;
  setLayout: React.Dispatch<React.SetStateAction<LayoutItem[]>>;
  setSelectedWidgetId: (id: string | null) => void;
  setSaving: (saving: boolean) => void;
  // Multi-widget selection (shift+click)
  // Version history (named snapshots)
  dashboardVersions: DashboardVersion[];
  saveVersionSnapshot: (label?: string) => void;
  loadVersionHistory: (dashboardId: string) => void;
  restoreVersionSnapshot: (versionId: string) => void;
  deleteVersionSnapshot: (versionId: string) => void;
  fetchDashboards: () => Promise<void>;
  loadDashboardById: (id: string) => Promise<boolean>;

  // Dashboard management
  addDashboard: (name?: string) => Promise<string>;
  duplicateDashboard: (id: string) => Promise<string>;
  seedDashboardStarterLayout: (kind: StarterLayoutKind, activePageId?: string | null) => Promise<void>;
  removeDashboard: (id: string) => Promise<void>;
  setActiveDashboardId: (id: string) => void;
  updateDashboardName: (id: string, name: string) => Promise<void>;
  updateDashboardMeta: (
    id: string,
    meta: { name?: string; description?: string; config?: Record<string, unknown> }
  ) => Promise<void>;
  setDashboardDescription: (id: string, description: string) => void;
  // Starred / favourites (local only — stored in localStorage)
  starredDashboardIds: Set<string>;
  toggleStarDashboard: (id: string) => void;
  // Tags — persisted in dashboard config
  updateDashboardTags: (id: string, tags: string[]) => Promise<void>;

  addWidget: (widget: WidgetInstance, layoutItem: LayoutItem) => void;
  removeWidget: (id: string) => void;
  duplicateWidget: (id: string) => Promise<void>;
  updateWidget: (id: string, updates: Partial<WidgetInstance>) => void;
  createChartAndFetchData: (widget: WidgetInstance) => Promise<void>;
  updateChartAndFetchData: (widgetId: string, updates: Partial<WidgetInstance>) => Promise<void>;
  deleteChart: (widgetId: string) => Promise<void>;
  fetchChartData: (widgetId: string) => Promise<void>;
  updateChartLayout: (widgetId: string, layoutOverride?: LayoutItem) => Promise<void>;
  removeChartFromAllDashboards: (chartId: string) => void;
  partitionSeriesData: (data: ChartData, widget: WidgetInstance) => ChartData;
  applyRemoteUpdate: (update: { type: string; id?: string; changes?: Record<string, unknown>; widget?: WidgetInstance }) => void;
  bulkDeleteWidgets: () => Promise<void>;
  updatePageLayout: (
    pageId: string | null,
    pageLayoutUpdate: LayoutItem[],
    defaultPageId?: string | null
  ) => void;
  applyDashboardColorPalette: (paletteId: string) => Promise<void>;
  moveWidgetToPage: (widgetId: string, targetPageId: string) => Promise<void>;
  copyWidgetToDashboard: (
    widget: WidgetInstance,
    layoutItem: LayoutItem | undefined,
    targetDashboardId: string
  ) => Promise<{ chartId: string; widgetId: string }>;
}

export type { WidgetDrillState };

export const useDashboardStore = create<DashboardState>()((set, get, store) => ({
  ...createDashboardUiSlice(set, get, store),
  ...createDashboardRuntimeSlice(set, get, store),
  dashboards: [],
  isLoadingDashboards: false,
  hasLoadedDashboards: false,
  dashboardError: null,
  activeDashboardId: null,
  widgets: [],
  layout: [],
  layoutCollabTs: 0,
  selectedWidgetId: null,
  _historyVersion: 0,

  historyUndo: () => {
    const snap = _undoStack.pop();
    if (!snap) return;
    const { widgets, layout } = get();
    _redoStack.push({ widgets, layout });
    set((state) => {
      const activeDashboardId = state.activeDashboardId;
      const dashboards = state.dashboards.map((d) =>
        d.id === activeDashboardId ? { ...d, widgets: snap.widgets, layout: snap.layout } : d
      );
      return { widgets: snap.widgets, layout: snap.layout, dashboards, _historyVersion: state._historyVersion + 1 };
    });
  },

  historyRedo: () => {
    const snap = _redoStack.pop();
    if (!snap) return;
    const { widgets, layout } = get();
    _undoStack.push({ widgets, layout });
    set((state) => {
      const activeDashboardId = state.activeDashboardId;
      const dashboards = state.dashboards.map((d) =>
        d.id === activeDashboardId ? { ...d, widgets: snap.widgets, layout: snap.layout } : d
      );
      return { widgets: snap.widgets, layout: snap.layout, dashboards, _historyVersion: state._historyVersion + 1 };
    });
  },

  partitionSeriesData,

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

  dashboardVersions: [],

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

    get().setActiveDashboardId(targetDashboardId);

    return { chartId: String(newChart.id), widgetId: newWidgetId };
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
            const { widgets, layout } = chartsToWidgetsAndLayout(charts);

            const cfg = d.config || {};
            return {
              id: d.id,
              name: d.title,
              description: d.description || '',
              config: cfg,
              tags: Array.isArray((cfg as any).tags) ? (cfg as any).tags : [],
              widgets,
              layout,
            };
          } catch (error) {
            console.error(`Failed to load charts for dashboard ${d.id}:`, error);
            return { id: d.id, name: d.title, config: d.config || {}, tags: [], widgets: [], layout: [] };
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
      const urlDashboardId =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null;
      const preferredId = urlDashboardId || currentActiveId;
      const targetDash =
        dashboards.find((d) => String(d.id) === String(preferredId)) || dashboards[0];
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

      if (targetDash.widgets.length > 0) {
        const widgetsToFetch = targetDash.widgets.filter(
          (w) => w.chartId && !isNonDataWidget(w.chartType) && !isRemixSnapshotWidget(w),
        );
        if (widgetsToFetch.length > 0) {
          await get().refreshAllChartData(widgetsToFetch.map((w) => w.id));
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

  loadDashboardById: async (id) => {
    const dashboardId = String(id);
    if (get().dashboards.some((d) => String(d.id) === dashboardId)) {
      get().setActiveDashboardId(dashboardId);
      return true;
    }

    try {
      const [dash, charts] = await Promise.all([
        chartService.getDashboard(dashboardId),
        chartService.listCharts(dashboardId),
      ]);
      const { widgets, layout } = chartsToWidgetsAndLayout(charts);

      const cfg = dash.config || {};
      const loaded: Dashboard = {
        id: dash.id,
        name: dash.title,
        description: dash.description || '',
        config: cfg,
        tags: Array.isArray((cfg as { tags?: string[] }).tags) ? (cfg as { tags: string[] }).tags : [],
        widgets,
        layout,
      };

      set((state) => ({ dashboards: [...state.dashboards, loaded] }));
      get().setActiveDashboardId(loaded.id);
      return true;
    } catch (error) {
      console.error(`Failed to load dashboard ${dashboardId}:`, error);
      return false;
    }
  },

  addDashboard: async (name) => {
    const { currentProjectId } = useProjectStore.getState();
    const projectId = isEnterpriseEdition ? currentProjectId : undefined;

    if (isEnterpriseEdition && !isValidUuid(projectId != null ? String(projectId) : null)) {
      throw new Error('Select a valid project before creating a dashboard');
    }

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
      throw new Error(formatApiValidationError(error));
    }
  },

  seedDashboardStarterLayout: async (kind, activePageId = null) => {
    const pairs = buildStarterDashboardWidgets(kind, activePageId);
    if (!pairs.length) return;

    for (const { widget, layoutItem } of pairs) {
      get().addWidget(widget, layoutItem);
      await get().createChartAndFetchData(widget);
    }
  },

  removeDashboard: async (id) => {
    try {
      // Backend cascades widgets, charts, pages, shares, and related rows.
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
    if (state.activeDashboardId === id) {
      set({ selectedWidgetId: null, isPropertiesCollapsed: true });
      return;
    }

    if (id) {
      const savedMode = readStudioMode(id);
      if (savedMode) {
        set({ studioMode: savedMode });
      }
    }

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
      runtimeFilters: [],
      globalFiltersConfig: [],
      pageFiltersConfig: [],
      widgetDrillState: {},
    });

    // Fetch chart data for all widgets that have chartId
    const widgetsToFetch = targetDash.widgets.filter((w) => w.chartId);
    for (const widget of widgetsToFetch) {
      get().fetchChartData(widget.id);
    }
  },

  updateDashboardMeta: async (id, meta) => {
    const payload: { title?: string; description?: string; config?: Record<string, unknown> } = {};
    if (meta.name !== undefined) payload.title = meta.name;
    if (meta.description !== undefined) payload.description = meta.description;
    if (meta.config !== undefined) payload.config = meta.config;
    if (!Object.keys(payload).length) return;

    await chartService.updateDashboard(id, payload);
    set((state) => ({
      dashboards: state.dashboards.map((d) =>
        d.id === id
          ? {
              ...d,
              ...(meta.name !== undefined ? { name: meta.name } : {}),
              ...(meta.description !== undefined ? { description: meta.description } : {}),
              ...(meta.config !== undefined ? { config: { ...(d.config || {}), ...meta.config } } : {}),
            }
          : d
      ),
    }));
  },

  updateDashboardName: async (id, name) => {
    try {
      await get().updateDashboardMeta(id, { name });
    } catch (error) {
      console.error('Failed to update dashboard name:', error);
      throw error;
    }
  },

  setDashboardDescription: (id, description) =>
    set((state) => ({
      dashboards: state.dashboards.map((d) => (d.id === id ? { ...d, description } : d)),
    })),

  duplicateDashboard: async (id) => {
    const { dashboards } = get();
    const src = dashboards.find((d) => d.id === id);
    const newName = src ? `${src.name} (Copy)` : 'Dashboard Copy';
    const newId = await get().addDashboard(newName);

    // Copy widgets via store (best-effort: creates new chart records server-side)
    const srcWidgets = src?.widgets || [];
    for (const w of srcWidgets) {
      if (w.chartId) {
        // Copy the widget to the new dashboard
        const layoutItem = get().layout.find((l) => l.i === w.id);
        try {
          await get().copyWidgetToDashboard(w, layoutItem, newId);
        } catch {
          // Non-fatal — partial copy is fine
        }
      }
    }
    return newId;
  },

  // Starred dashboards (client-only, persisted in localStorage)
  starredDashboardIds: (() => {
    if (typeof window === 'undefined') return new Set<string>();
    try {
      const raw = localStorage.getItem('aicser_starred_dashboards');
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  })(),

  toggleStarDashboard: (id) =>
    set((state) => {
      const next = new Set(state.starredDashboardIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('aicser_starred_dashboards', JSON.stringify([...next])); } catch {}
      return { starredDashboardIds: next };
    }),

  updateDashboardTags: async (id, tags) => {
    // Optimistic update
    set((state) => ({
      dashboards: state.dashboards.map((d) =>
        d.id === id ? { ...d, tags } : d
      ),
    }));
    try {
      // Persist via updateDashboardMeta — tags are stored in config
      await chartService.updateDashboard(id, {
        config: { ...get().dashboards.find((d) => d.id === id)?.config, tags },
      });
    } catch {
      // Revert on failure
      console.error('[updateDashboardTags] failed to persist');
    }
  },

  addWidget: (widget, layoutItem) => {
    const { widgets, layout } = get();
    pushUndo({ widgets, layout });
    set((state) => {
      const next = [...state.widgets, widget];
      const nextLayout = [...state.layout, layoutItem];
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, widgets: next, layout: nextLayout } : d
      );
      return { widgets: next, layout: nextLayout, dashboards, selectedWidgetId: widget.id, isPropertiesCollapsed: false, _historyVersion: state._historyVersion + 1 };
    });
  },
  removeWidget: (id) => {
    const { widgets, layout } = get();
    pushUndo({ widgets, layout });
    set((state) => {
      const next = state.widgets.filter((w) => w.id !== id);
      const nextLayout = state.layout.filter((l) => l.i !== id);
      const selectedWidgetId = state.selectedWidgetId === id ? null : state.selectedWidgetId;
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, widgets: next, layout: nextLayout } : d
      );
      return { widgets: next, layout: nextLayout, selectedWidgetId, dashboards, _historyVersion: state._historyVersion + 1 };
    });
  },

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
        layout: sanitizeLayoutItem(newLayout),
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
      // Ensure chartQuery has default values.
      // When yMetrics is set, clear stale yMetricsSecondary — prevents ghost series
      // from prior configurations surviving into a fresh chart create.
      const hasYMetrics = (widget.chartQuery?.yMetrics?.length ?? 0) > 0;
      const chartQuery = {
        ...widget.chartQuery,
        x: widget.chartQuery?.x || '',
        yMetric: (widget.chartQuery?.yMetric || 'count') as 'count' | 'sum',
        yMetrics: widget.chartQuery?.yMetrics || [],
        yMetricsSecondary: hasYMetrics ? [] : (widget.chartQuery?.yMetricsSecondary || []),
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
          layout: sanitizeLayoutItem(layoutItem, maxLayoutY(state.layout)),
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

      const skipDataFetch = isNonDataWidget(widget.chartType);

      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widget.id ? { ...w, chartId: chart.id, isLoading: false } : w
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      if (skipDataFetch) {
        return;
      }

      try {
        const filterConfigs = studioFilterConfigs(get().globalFiltersConfig, get().pageFiltersConfig);
        const { chartData } = await fetchWidgetChartData({
          dashboardId: activeDashboardId,
          widget: { ...widget, chartId: chart.id },
          runtimeFilters: get().runtimeFilters,
          filterConfigs,
        });

        set((state) => {
          const nextWidgets = state.widgets.map((w) => (w.id === widget.id ? { ...w, chartData } : w));
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
      // When yMetrics is explicitly in the update, clear stale secondary unless secondary
      // was also explicitly set — prevents ghost series from prior configurations.
      const yMetricsExplicitlyUpdated = updates.chartQuery && 'yMetrics' in updates.chartQuery;
      const yMetricsSecondaryExplicitlyUpdated = updates.chartQuery && 'yMetricsSecondary' in updates.chartQuery;
      const chartQuery = {
        ...mergedChartQuery,
        x: mergedChartQuery.x || '',
        yMetric: (mergedChartQuery.yMetric || 'count') as 'count' | 'sum',
        yMetrics: mergedChartQuery.yMetrics || [],
        yMetricsSecondary: (yMetricsExplicitlyUpdated && !yMetricsSecondaryExplicitlyUpdated)
          ? []
          : (mergedChartQuery.yMetricsSecondary || []),
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

      const isStaticWidget = isNonDataWidget(updates.chartType || widget.chartType);

      if (isStaticWidget) {
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
        const filterConfigs = studioFilterConfigs(state.globalFiltersConfig, state.pageFiltersConfig);
        const { chartData } = await fetchWidgetChartData({
          dashboardId: activeDashboardId,
          widget: { ...widget, ...updates, chartId: updatedChart.id },
          runtimeFilters: state.runtimeFilters,
          filterConfigs,
          drillState: state.widgetDrillState[widgetId],
        });

        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widgetId ? { ...w, ...updates, chartData, isLoading: false } : w
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
      if (isNonDataWidget(widget.chartType)) return;
      if (isRemixSnapshotWidget(widget) && widget.chartData) return;

      set((state) => {
        const nextWidgets = state.widgets.map((w) => (w.id === widgetId ? { ...w, isLoading: true, error: null } : w));
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
        );
        return { widgets: nextWidgets, dashboards };
      });

      const filterConfigs = studioFilterConfigs(get().globalFiltersConfig, get().pageFiltersConfig);
      const { chartData } = await fetchWidgetChartData({
        dashboardId: activeDashboardId,
        widget,
        runtimeFilters: get().runtimeFilters,
        filterConfigs,
        drillState: get().widgetDrillState[widgetId],
      });

      set((state) => {
        const nextWidgets = state.widgets.map((w) =>
          w.id === widgetId ? { ...w, chartData, isLoading: false } : w
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

  updateChartLayout: async (widgetId: string, layoutOverride?: LayoutItem) => {
    try {
      const state = get();
      const widget = state.widgets.find((w) => w.id === widgetId);
      const layoutItem = layoutOverride ?? state.layout.find((l) => l.i === widgetId);
      const activeDashboardId = state.activeDashboardId;

      if (!activeDashboardId || !widget?.chartId || !layoutItem) return;

      const safe = sanitizeLayoutItem(layoutItem, maxLayoutY(state.layout));
      await chartService.updateChartLayout(activeDashboardId, widget.chartId, safe);
    } catch (error) {
      console.error('Failed to update chart layout:', error);
      throw new Error(formatApiValidationError(error));
    }
  },

  applyRemoteUpdate: (update) => {
    if (update.type === 'layout:update' && Array.isArray(update.layout)) {
      const layoutTs = (update as { layoutTs?: number }).layoutTs ?? 0;
      set((state) => {
        const localTs = state.layoutCollabTs ?? 0;
        if (layoutTs < localTs) return state;
        const layout = update.layout as LayoutItem[];
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, layout } : d,
        );
        return { layout, layoutCollabTs: layoutTs, dashboards };
      });
      return;
    }
    if (update.type === 'widget:update' && update.id && update.changes) {
      const collabTs =
        (update as { collabTs?: number }).collabTs ??
        (update.changes as { collabTs?: number }).collabTs ??
        0;
      set((state) => {
        const existing = state.widgets.find((w) => w.id === update.id || w.chartId === update.id);
        if (existing && (existing.collabTs ?? 0) > collabTs) return state;

        const widgets = state.widgets.map((w) => {
          if (w.id !== update.id && w.chartId !== update.id) return w;
          const { collabTs: _drop, ...rest } = update.changes as Partial<WidgetInstance> & { collabTs?: number };
          return { ...w, ...rest, collabTs };
        });
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets } : d,
        );
        return { widgets, dashboards };
      });
      return;
    }
    if (update.type === 'widget:add' && update.widget) {
      const widget = update.widget as WidgetInstance;
      const layoutItem = (update as { layout?: LayoutItem }).layout;
      set((state) => {
        if (state.widgets.some((w) => w.id === widget.id)) return state;
        const widgets = [...state.widgets, widget];
        let layout = state.layout;
        if (layoutItem && !layout.some((l) => l.i === layoutItem.i)) {
          layout = [...layout, layoutItem];
        }
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets, layout } : d,
        );
        return { widgets, layout, dashboards };
      });
      return;
    }
    if (update.type === 'widget:remove' && update.id) {
      set((state) => {
        const widgets = state.widgets.filter((w) => w.id !== update.id && w.chartId !== update.id);
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets } : d
        );
        return { widgets, dashboards };
      });
    }
  },

  updatePageLayout: (pageId, pageLayoutUpdate, defaultPageId = null) => {
    set((state) => {
      const layout = mergePageLayout(state.layout, pageLayoutUpdate, pageId, defaultPageId);
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, layout } : d
      );
      return { layout, dashboards };
    });
  },

  applyDashboardColorPalette: async (paletteId: string) => {
    const state = get();
    const activeDashboardId = state.activeDashboardId;
    if (!activeDashboardId) return;

    const paletteColors = getColorsFromPalette(paletteId);
    const previousPalette = state.dashboards.find((d) => d.id === activeDashboardId)?.config
      ?.default_color_palette as string | undefined;

    const shouldFollowDashboardPalette = (widgetPalette: string | undefined | null) => {
      if (widgetPalette === 'custom') return false;
      if (isWidgetPaletteInherited(widgetPalette)) return true;
      if (!previousPalette || widgetPalette === previousPalette) return true;
      return false;
    };

    try {
      const dash = await chartService.getDashboard(activeDashboardId);
      const nextConfig = { ...(dash.config || {}), default_color_palette: paletteId };
      await chartService.updateDashboard(activeDashboardId, { config: nextConfig });
      set((s) => ({
        dashboards: s.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, config: nextConfig } : d,
        ),
        widgets: s.widgets.map((w) => {
          if (w.chartType === 'text' || w.chartType === 'slicer') return w;
          if (!shouldFollowDashboardPalette(w.chartOptions?.colorPalette)) return w;
          const snapshot = w.chartOptions?.__echartsSnapshot;
          const nextOptions: Record<string, unknown> = {
            ...w.chartOptions,
            colorPalette: WIDGET_PALETTE_INHERIT,
            customColor: undefined,
            customPalette: undefined,
            paletteInverted: false,
          };
          if (snapshot && typeof snapshot === 'object') {
            nextOptions.__echartsSnapshot = {
              ...(snapshot as Record<string, unknown>),
              color: paletteColors,
            };
          }
          return { ...w, chartOptions: nextOptions as WidgetInstance['chartOptions'] };
        }),
      }));
    } catch (error) {
      console.error('[applyDashboardColorPalette] config save failed:', error);
      throw error;
    }

    const targets = state.widgets.filter(
      (w) =>
        w.chartId &&
        w.chartType !== 'text' &&
        w.chartType !== 'slicer' &&
        shouldFollowDashboardPalette(w.chartOptions?.colorPalette),
    );

    await Promise.all(
      targets.map((w) => {
        const snapshot = w.chartOptions?.__echartsSnapshot;
        const nextOptions: Record<string, unknown> = {
          ...w.chartOptions,
          colorPalette: WIDGET_PALETTE_INHERIT,
          customColor: undefined,
          customPalette: undefined,
          paletteInverted: false,
        };
        if (snapshot && typeof snapshot === 'object') {
          nextOptions.__echartsSnapshot = {
            ...(snapshot as Record<string, unknown>),
            color: paletteColors,
          };
        }
        return get().updateChartAndFetchData(w.id, { chartOptions: nextOptions });
      }),
    );
  },

  moveWidgetToPage: async (widgetId, targetPageId) => {
    const state = get();
    const layoutItem = state.layout.find((l) => l.i === widgetId);
    const widget = state.widgets.find((w) => w.id === widgetId);
    const activeDashboardId = state.activeDashboardId;
    if (!layoutItem || !activeDashboardId) return;

    const updatedItem: LayoutItem = { ...layoutItem, pageId: targetPageId };
    set((s) => {
      const layout = s.layout.map((l) => (l.i === widgetId ? updatedItem : l));
      const dashboards = s.dashboards.map((d) =>
        d.id === s.activeDashboardId ? { ...d, layout } : d
      );
      return { layout, dashboards };
    });

    if (widget?.chartId) {
      const safe = sanitizeLayoutItem(updatedItem);
      await chartService.updateChartLayout(activeDashboardId, widget.chartId, {
        ...safe,
        page_id: targetPageId,
      });
    }
  },

  bulkDeleteWidgets: async () => {
    const { selectedWidgetIds, widgets } = get();
    if (!selectedWidgetIds.size) return;
    const ids = [...selectedWidgetIds];
    get().clearMultiSelection();
    for (const id of ids) {
      const widget = widgets.find((w) => w.id === id);
      if (widget?.chartId) {
        try { await get().deleteChart(id); } catch {}
      } else {
        get().removeWidget(id);
      }
    }
  },

  // ─── Version history ──────────────────────────────────────────────────────
  loadVersionHistory: (dashboardId) => {
    const versions = loadVersions(dashboardId);
    set({ dashboardVersions: versions });
  },

  saveVersionSnapshot: (label) => {
    const { activeDashboardId, widgets, layout } = get();
    if (!activeDashboardId) return;
    const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const version: DashboardVersion = {
      id,
      dashboardId: activeDashboardId,
      label: label || new Date().toLocaleString(),
      savedAt: Date.now(),
      widgets: JSON.parse(JSON.stringify(widgets)),
      layout: JSON.parse(JSON.stringify(layout)),
    };
    const existing = loadVersions(activeDashboardId);
    const next = [version, ...existing].slice(0, MAX_VERSIONS);
    persistVersions(activeDashboardId, next);
    set({ dashboardVersions: next });
  },

  restoreVersionSnapshot: (versionId) => {
    const { activeDashboardId, dashboardVersions } = get();
    const version = dashboardVersions.find((v) => v.id === versionId);
    if (!version || !activeDashboardId) return;
    const { widgets, layout } = version;
    // Save current state as a recovery point first
    get().saveVersionSnapshot(`Before restore — ${new Date().toLocaleString()}`);
    set((state) => {
      const dashboards = state.dashboards.map((d) =>
        d.id === activeDashboardId ? { ...d, widgets, layout } : d
      );
      return { widgets, layout, dashboards, selectedWidgetId: null };
    });
  },

  deleteVersionSnapshot: (versionId) => {
    const { activeDashboardId, dashboardVersions } = get();
    if (!activeDashboardId) return;
    const next = dashboardVersions.filter((v) => v.id !== versionId);
    persistVersions(activeDashboardId, next);
    set({ dashboardVersions: next });
  },
}));
