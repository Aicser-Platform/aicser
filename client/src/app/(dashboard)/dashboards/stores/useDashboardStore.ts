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
import { sanitizeLayoutItem, maxLayoutY, findFreeLayoutPosition, resolveLayoutCollisions, placePinnedLayoutItem } from '../utils/layoutSanitize';
import { hasRenderableChartData, hasRunnableChartSource, mergeChartOptions } from '@/components/charts/chartDesignerBridge';
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
    const prefetch = (chart.chartOptions as Record<string, unknown> | undefined)
      ?.__prefetchedChartData;

    const baseWidget: WidgetInstance = {
      id: widgetId,
      chartId: chart.id,
      dataSourceId: chart.dataSourceId ?? undefined,
      title: chart.title || '',
      chartType: (chart.chartType as WidgetType) || 'bar',
      chartQuery: chart.chartQuery,
      chartOptions: chart.chartOptions,
      // Hydrate immediately from Visualize/Chat prefetch so widgets render before /data
      chartData: hasRenderableChartData(prefetch) ? (prefetch as ChartData) : undefined,
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

  // Heal stacked widgets saved under older allowOverlap sessions — per page.
  const byPage = new Map<string, LayoutItem[]>();
  for (const item of layout) {
    const key = item.pageId ? String(item.pageId) : '__default__';
    const bucket = byPage.get(key) ?? [];
    bucket.push(item);
    byPage.set(key, bucket);
  }
  const healed: LayoutItem[] = [];
  for (const group of byPage.values()) {
    healed.push(...resolveLayoutCollisions(group, { cols: 12 }));
  }

  return { widgets, layout: healed };
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
  // Version history (named snapshots — server-backed)
  dashboardVersions: DashboardVersion[];
  isLoadingVersions: boolean;
  versionsError: string | null;
  saveVersionSnapshot: (label?: string) => Promise<void>;
  loadVersionHistory: (dashboardId: string) => Promise<void>;
  restoreVersionSnapshot: (versionId: string) => Promise<void>;
  deleteVersionSnapshot: (versionId: string) => Promise<void>;
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
  applyRemoteUpdate: (update: {
    type: string;
    id?: string;
    changes?: Record<string, unknown>;
    widget?: WidgetInstance;
    layout?: LayoutItem[];
    layoutTs?: number;
  }) => void;
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
  linkWidgetToDashboard: (
    widget: WidgetInstance,
    layoutItem: LayoutItem | undefined,
    targetDashboardId: string,
    mode?: 'link' | 'copy'
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
  isLoadingVersions: false,
  versionsError: null,

  copyWidgetToDashboard: async (widget, layoutItem, targetDashboardId) => {
    const state = get();

    const targetDashboard = state.dashboards.find((d) => String(d.id) === String(targetDashboardId));
    let targetLayout = targetDashboard?.layout ?? [];
    try {
      const charts = await chartService.listCharts(targetDashboardId);
      targetLayout = charts.map((c) => ({
        i: `widget-${c.id}`,
        x: Number(c.layout?.x) || 0,
        y: Number(c.layout?.y) || 0,
        w: Number(c.layout?.w) || 6,
        h: Number(c.layout?.h) || 5,
        ...(c.layout?.page_id ? { pageId: String(c.layout.page_id) } : {}),
      }));
    } catch {
      /* use cached */
    }

    const layout = placePinnedLayoutItem(targetLayout, {
      x: layoutItem?.x,
      y: layoutItem?.y,
      w: layoutItem?.w ?? 6,
      h: layoutItem?.h ?? 5,
      pageId: layoutItem?.pageId,
    });

    // Build the payload for the API — send the safe layout position
    const payload = {
      dataSourceId: widget.dataSourceId || null,
      chartType: widget.chartType,
      title: `${widget.title || 'Untitled'} (Copy)`,
      chartQuery: widget.chartQuery || {},
      chartOptions: widget.chartOptions || {},
      layout: { x: layout.x, y: layout.y, w: layout.w, h: layout.h },
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
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: layout.h,
      ...(layout.page_id ? { pageId: String(layout.page_id) } : {}),
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

  /** Default pin: link existing library chart (no duplicate definition). */
  linkWidgetToDashboard: async (widget, layoutItem, targetDashboardId, mode: 'link' | 'copy' = 'link') => {
    const state = get();
    if (!widget.chartId) {
      throw new Error('Chart must be saved before linking to a dashboard');
    }

    const targetDashboard = state.dashboards.find((d) => String(d.id) === String(targetDashboardId));
    let targetLayout = targetDashboard?.layout ?? [];
    // Prefer live target board layout so we don't collide using a stale in-memory list
    try {
      const charts = await chartService.listCharts(targetDashboardId);
      targetLayout = charts.map((c) => ({
        i: `widget-${c.id}`,
        x: Number(c.layout?.x) || 0,
        y: Number(c.layout?.y) || 0,
        w: Number(c.layout?.w) || 6,
        h: Number(c.layout?.h) || 5,
        ...(c.layout?.page_id ? { pageId: String(c.layout.page_id) } : {}),
      }));
    } catch {
      /* use cached layout */
    }
    const layout = placePinnedLayoutItem(targetLayout, {
      x: layoutItem?.x,
      y: layoutItem?.y,
      w: layoutItem?.w ?? 6,
      h: layoutItem?.h ?? 5,
      pageId: layoutItem?.pageId,
    });

    if (mode === 'copy') {
      return get().copyWidgetToDashboard(widget, layoutItem, targetDashboardId);
    }

    const linked = await chartService.linkChart(targetDashboardId, {
      chartId: String(widget.chartId),
      mode: 'link',
      layout,
    });

    const newWidgetId = `widget-${linked.id}`;
    const newWidget: WidgetInstance = {
      id: newWidgetId,
      chartId: linked.id,
      dataSourceId: linked.dataSourceId ?? widget.dataSourceId,
      title: linked.title || widget.title || '',
      chartType: (linked.chartType as WidgetType) || widget.chartType,
      chartQuery: linked.chartQuery || widget.chartQuery,
      chartOptions: linked.chartOptions || widget.chartOptions,
      chartData: undefined,
      isLoading: false,
      error: null,
    };
    const newLayoutItem: LayoutItem = {
      i: newWidgetId,
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: layout.h,
    };

    const updatedDashboards = state.dashboards.map((d) => {
      if (String(d.id) !== String(targetDashboardId)) return d;
      if (d.widgets.some((w) => String(w.chartId) === String(linked.id))) return d;
      return {
        ...d,
        widgets: [...d.widgets, newWidget],
        layout: [...d.layout, newLayoutItem],
      };
    });

    const isTargetActive = String(state.activeDashboardId) === String(targetDashboardId);
    set({
      dashboards: updatedDashboards,
      ...(isTargetActive
        ? {
            widgets: state.widgets.some((w) => String(w.chartId) === String(linked.id))
              ? state.widgets
              : [...state.widgets, newWidget],
            layout: state.layout.some((l) => l.i === newWidgetId)
              ? state.layout
              : [...state.layout, newLayoutItem],
          }
        : {}),
    });

    if (linked.dataSourceId || widget.dataSourceId) {
      get().fetchChartData(newWidgetId);
    }
    get().setActiveDashboardId(targetDashboardId);
    return { chartId: String(linked.id), widgetId: newWidgetId };
  },

  fetchDashboards: async () => {
    const { currentProjectId } = useProjectStore.getState();
    const projectId = isEnterpriseEdition ? currentProjectId : undefined;

    set({ isLoadingDashboards: true, dashboardError: null });
    try {
      const { dashboardLibraryService } = await import('../services/dashboardLibraryService');
      // Summary-only first page — never N+1 listCharts for every board
      const page = await dashboardLibraryService.list({
        projectId: projectId ?? undefined,
        facet: 'all',
        limit: 100,
        offset: 0,
        detail: 'summary',
      });

      const dashboards: Dashboard[] = page.dashboards.map((d) => {
        const cfg = (d.config || {}) as Record<string, unknown>;
        const tags = Array.isArray(d.tags)
          ? d.tags.map(String)
          : Array.isArray(cfg.tags)
            ? (cfg.tags as unknown[]).map(String)
            : [];
        return {
          id: String(d.id),
          name: d.title || d.name || String(d.id),
          description: d.description || '',
          config: cfg,
          tags,
          isFavorite: Boolean(d.isFavorite),
          collectionId: d.collectionId ?? null,
          chartCount: d.chartCount ?? 0,
          widgets: [],
          layout: [],
        };
      });

      const starred = new Set(
        dashboards.filter((d) => d.isFavorite).map((d) => String(d.id)),
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
        starredDashboardIds: starred,
        isLoadingDashboards: false,
        hasLoadedDashboards: true,
        dashboardError: null,
      });

      // Hydrate only the active board's widgets/layout (SSOT scale path)
      await get().loadDashboardById(String(nextActiveId));
      try {
        await dashboardLibraryService.touch(String(nextActiveId));
      } catch {
        /* optional */
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

      const prevSelected = get().selectedWidgetId;
      set((state) => {
        const exists = state.dashboards.some((d) => String(d.id) === dashboardId);
        const dashboards = exists
          ? state.dashboards.map((d) => (String(d.id) === dashboardId ? { ...d, ...loaded } : d))
          : [...state.dashboards, loaded];
        const isActive = String(state.activeDashboardId) === dashboardId;
        return {
          dashboards,
          ...(isActive ? { widgets: loaded.widgets, layout: loaded.layout } : {}),
        };
      });

      // Activate without wiping a selection that was just set (e.g. Visualize pin)
      if (String(get().activeDashboardId) !== dashboardId) {
        get().setActiveDashboardId(loaded.id);
      } else {
        // Already active — widgets just refreshed; restore selection and refetch data
        const stillThere =
          prevSelected &&
          get().widgets.some(
            (w) => w.id === prevSelected || String(w.chartId) === String(prevSelected),
          );
        if (stillThere) {
          set({ selectedWidgetId: prevSelected, isPropertiesCollapsed: false });
        }
        const widgetsToFetch = loaded.widgets.filter(
          (w) => w.chartId && !isNonDataWidget(w.chartType) && !isRemixSnapshotWidget(w),
        );
        for (const widget of widgetsToFetch) {
          void get().fetchChartData(widget.id);
        }
      }
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
      const isDeletingActive = String(activeDashboardId) === String(id);

      set({ dashboards: newDashboards });

      // Only switch when the deleted dashboard was active — otherwise a sibling
      // delete would re-enter setActiveDashboardId and poison cached layouts / page URL.
      if (isDeletingActive) {
        const nextActiveId = newDashboards.length > 0 ? newDashboards[0].id : null;
        if (nextActiveId) {
          get().setActiveDashboardId(nextActiveId);
        } else {
          set({
            activeDashboardId: null,
            widgets: [],
            layout: [],
            selectedWidgetId: null,
          });
        }
      }
    } catch (error) {
      console.error('Failed to remove dashboard:', error);
      throw error;
    }
  },

  setActiveDashboardId: (id) => {
    const state = get();
    // Same dashboard — keep current selection (needed after Visualize pin / deep-link).
    if (String(state.activeDashboardId) === String(id)) {
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
      String(d.id) === String(state.activeDashboardId)
        ? { ...d, widgets: state.widgets, layout: state.layout }
        : d
    );

    const targetDash = updatedDashboards.find((d) => String(d.id) === String(id));
    if (!targetDash) {
      // Not in the summary page — hydrate from API
      if (id) void get().loadDashboardById(String(id));
      return;
    }

    const needsHydrate = !targetDash.widgets?.length;
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

    if (needsHydrate) {
      void get().loadDashboardById(String(id)).then(() => {
        try {
          void import('../services/dashboardLibraryService').then(({ dashboardLibraryService }) =>
            dashboardLibraryService.touch(String(id)),
          );
        } catch {
          /* optional */
        }
      });
      return;
    }

    const widgetsToFetch = targetDash.widgets.filter((w) => w.chartId);
    for (const widget of widgetsToFetch) {
      get().fetchChartData(widget.id);
    }
    try {
      void import('../services/dashboardLibraryService').then(({ dashboardLibraryService }) =>
        dashboardLibraryService.touch(String(id)),
      );
    } catch {
      /* optional */
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

  // Starred dashboards — seeded from server isFavorite; toggles hit the library API
  starredDashboardIds: new Set<string>(),

  toggleStarDashboard: (id) => {
    const state = get();
    const next = new Set(state.starredDashboardIds);
    const willFavorite = !next.has(id);
    if (willFavorite) next.add(id);
    else next.delete(id);
    set({
      starredDashboardIds: next,
      dashboards: state.dashboards.map((d) =>
        String(d.id) === String(id) ? { ...d, isFavorite: willFavorite } : d,
      ),
    });
    void import('../services/dashboardLibraryService')
      .then(({ dashboardLibraryService }) => dashboardLibraryService.setFavorite(String(id), willFavorite))
      .catch((err) => {
        console.error('[toggleStarDashboard]', err);
        // Revert
        const revert = new Set(get().starredDashboardIds);
        if (willFavorite) revert.delete(id);
        else revert.add(id);
        set({
          starredDashboardIds: revert,
          dashboards: get().dashboards.map((d) =>
            String(d.id) === String(id) ? { ...d, isFavorite: !willFavorite } : d,
          ),
        });
      });
  },

  updateDashboardTags: async (id, tags) => {
    // Optimistic update
    set((state) => ({
      dashboards: state.dashboards.map((d) =>
        d.id === id ? { ...d, tags } : d
      ),
    }));
    try {
      await chartService.updateDashboard(id, {
        tags,
        config: { ...get().dashboards.find((d) => d.id === id)?.config, tags },
      } as any);
    } catch {
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
      return {
        widgets: next,
        layout: nextLayout,
        dashboards,
        selectedWidgetId: widget.id,
        // Keep properties collapsed on drop/add — open only on explicit click/configure.
        _historyVersion: state._historyVersion + 1,
      };
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
    const newLayout = findFreeLayoutPosition(
      state.layout,
      {
        x: Math.min(originalLayoutItem.x + 1, 11),
        y: originalLayoutItem.y + originalLayoutItem.h,
        w: originalLayoutItem.w,
        h: originalLayoutItem.h,
      },
      12,
    );

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
      const widgets = state.widgets.map((w) => {
        if (w.id !== id) return w;
        const next: typeof w = { ...w, ...updates };
        if (updates.chartOptions) {
          next.chartOptions = mergeChartOptions(
            w.chartOptions as Record<string, unknown> | undefined,
            updates.chartOptions as Record<string, unknown>,
          );
        }
        if (updates.chartQuery) {
          next.chartQuery = mergeChartOptions(
            (w.chartQuery || {}) as Record<string, unknown>,
            updates.chartQuery as Record<string, unknown>,
          ) as typeof w.chartQuery;
        }
        return next;
      });
      const dashboards = state.dashboards.map((d) =>
        d.id === state.activeDashboardId ? { ...d, widgets } : d,
      );
      return { widgets, dashboards };
    }),

  createChartAndFetchData: async (widget: WidgetInstance) => {
    try {
      // Preserve secondary metrics — do not wipe on create (combo / dual-axis).
      const chartQuery = {
        ...widget.chartQuery,
        x: widget.chartQuery?.x || '',
        yMetric: (widget.chartQuery?.yMetric || 'count') as 'count' | 'sum',
        yMetrics: widget.chartQuery?.yMetrics || [],
        yMetricsSecondary: widget.chartQuery?.yMetricsSecondary || [],
        y: widget.chartQuery?.y || '',
        legend: widget.chartQuery?.legend || '',
        groupField: widget.chartQuery?.groupField || '',
        sortBy: widget.chartQuery?.sortBy || 'x',
        joins: widget.chartQuery?.joins || [],
        limit: widget.chartQuery?.limit,
        seriesLimit: widget.chartQuery?.seriesLimit,
        sortOrder: widget.chartQuery?.sortOrder,
        saved_query_id: widget.chartQuery?.saved_query_id,
        query_snapshot_id: (widget.chartQuery as any)?.query_snapshot_id,
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
          w.id === widget.id
            ? { ...w, chartId: chart.id, lastFetchedQueryHash: widget.lastFetchedQueryHash, isLoading: false }
            : w
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
          const nextWidgets = state.widgets.map((w) =>
            w.id === widget.id
              ? { ...w, chartData, lastFetchedQueryHash: widget.lastFetchedQueryHash, isLoading: false, error: null }
              : w
          );
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
      } catch (dataError) {
        console.error('Failed to fetch data for chart:', dataError);
        const errorMessage = dataError instanceof Error ? dataError.message : 'Failed to fetch chart data';
        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widget.id ? { ...w, isLoading: false, error: errorMessage } : w
          );
          const dashboards = state.dashboards.map((d) =>
            d.id === activeDashboardId ? { ...d, widgets: nextWidgets } : d
          );
          return { widgets: nextWidgets, dashboards };
        });
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

      // Build complete chartQuery with defaults — never wipe secondary unless
      // the caller explicitly set yMetricsSecondary (including to []).
      const mergedChartQuery = { ...widget.chartQuery, ...updates.chartQuery };
      const chartQuery = {
        ...mergedChartQuery,
        x: mergedChartQuery.x || '',
        yMetric: (mergedChartQuery.yMetric || 'count') as 'count' | 'sum',
        yMetrics: mergedChartQuery.yMetrics || [],
        yMetricsSecondary: mergedChartQuery.yMetricsSecondary || [],
        y: mergedChartQuery.y || '',
        legend: mergedChartQuery.legend || '',
        groupField: mergedChartQuery.groupField || '',
        sortBy: mergedChartQuery.sortBy || 'x',
        joins: mergedChartQuery.joins || [],
        limit: mergedChartQuery.limit,
        seriesLimit: mergedChartQuery.seriesLimit,
        sortOrder: mergedChartQuery.sortOrder,
        saved_query_id: mergedChartQuery.saved_query_id,
        query_snapshot_id: (mergedChartQuery as any).query_snapshot_id,
      };

      // Merge chartOptions — undefined/null in updates deletes keys (strip prefetch/SQL)
      const mergedChartOptions = mergeChartOptions(
        widget.chartOptions as Record<string, unknown> | undefined,
        updates.chartOptions as Record<string, unknown> | undefined,
      );

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
          widget: {
            ...widget,
            ...updates,
            chartId: updatedChart.id,
            chartQuery,
            chartOptions: mergedChartOptions,
            dataSourceId: updatePayload.dataSourceId,
          },
          runtimeFilters: state.runtimeFilters,
          filterConfigs,
          drillState: state.widgetDrillState[widgetId],
        });

        // After a successful live fetch, drop pin freeze so renderer uses chartData
        const liveOptions = mergeChartOptions(mergedChartOptions, {
          __prefetchedChartData: undefined,
          __echartsSnapshot: undefined,
        });

        set((state) => {
          const nextWidgets = state.widgets.map((w) =>
            w.id === widgetId
              ? {
                  ...w,
                  ...updates,
                  chartQuery,
                  chartOptions: liveOptions,
                  chartData,
                  isLoading: false,
                  error: null,
                }
              : w,
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

      // Industry default: remove from this board only (unlink). Library chart stays.
      await chartService.unlinkChart(activeDashboardId, widget.chartId);
      get().removeWidget(widgetId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove chart';
      console.error('[deleteChart] Error:', errorMessage);

      set((state) => ({
        widgets: state.widgets.map((w) => (w.id === widgetId ? { ...w, error: errorMessage } : w)),
      }));

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
      // Skip live fetch only when there is nothing runnable AND a pin snapshot/prefetch
      // can still render. Chat/QE widgets that later gain saved_query_id / table fields
      // must refresh on Apply / data-source changes.
      const chartOpts = widget.chartOptions as Record<string, unknown> | undefined;
      if (!hasRunnableChartSource(widget)) {
        if (chartOpts?.__echartsSnapshot) return;
        if (hasRenderableChartData(chartOpts?.__prefetchedChartData)) return;
      }

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
      // Scaffold / local-only widgets use non-UUID ids — skip server persist.
      if (!isValidUuid(activeDashboardId) || !isValidUuid(widget.chartId)) return;

      const safe = sanitizeLayoutItem(layoutItem, maxLayoutY(state.layout));
      await chartService.updateChartLayout(activeDashboardId, widget.chartId, safe);
    } catch (error) {
      // Soft-fail: local layout already applied; don't surface as an unhandled rejection.
      console.error('Failed to update chart layout:', formatApiValidationError(error), error);
    }
  },

  applyRemoteUpdate: (update) => {
    if (update.type === 'layout:update' && Array.isArray(update.layout)) {
      const layoutTs = update.layoutTs ?? 0;
      const remoteLayout = update.layout;
      set((state) => {
        const localTs = state.layoutCollabTs ?? 0;
        if (layoutTs < localTs) return state;
          const layout = remoteLayout;
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

    const shouldFollowDashboardPalette = (widgetPalette: unknown) => {
      const palette = typeof widgetPalette === 'string' ? widgetPalette : undefined;
      if (palette === 'custom') return false;
      if (isWidgetPaletteInherited(palette)) return true;
      if (!previousPalette || palette === previousPalette) return true;
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
          if (w.chartType === 'text' || w.chartType === 'slicer' || w.chartType === 'filter') return w;
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
        w.chartType !== 'filter' &&
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
      if (!isValidUuid(widget.chartId) || !isValidUuid(activeDashboardId)) return;
      try {
        const safe = sanitizeLayoutItem(updatedItem);
        await chartService.updateChartLayout(activeDashboardId, widget.chartId, {
          ...safe,
          page_id: targetPageId,
        });
      } catch (error) {
        console.error('Failed to move widget page layout:', formatApiValidationError(error), error);
      }
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

  // ─── Version history (server-backed — /api/dashboards/{id}/versions) ───────
  loadVersionHistory: async (dashboardId) => {
    set({ isLoadingVersions: true, versionsError: null });
    try {
      const versions = await chartService.listVersions(dashboardId);
      set({
        dashboardVersions: versions.map((v) => ({
          id: v.id,
          dashboardId: v.dashboardId,
          label: v.label,
          savedAt: v.savedAt ?? 0,
          widgetCount: v.widgetCount,
        })),
        isLoadingVersions: false,
      });
    } catch (error) {
      console.error(`Failed to load version history for dashboard ${dashboardId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load version history';
      set({ isLoadingVersions: false, versionsError: errorMessage });
    }
  },

  saveVersionSnapshot: async (label) => {
    const { activeDashboardId, widgets, layout } = get();
    if (!activeDashboardId) return;
    try {
      await chartService.createVersion(activeDashboardId, {
        label: label || new Date().toLocaleString(),
        config: {
          widgets: JSON.parse(JSON.stringify(widgets)),
          layout: JSON.parse(JSON.stringify(layout)),
        },
      });
      // Refresh from the server so the list (and the 20-version cap) stays authoritative.
      await get().loadVersionHistory(activeDashboardId);
    } catch (error) {
      console.error('Failed to save version snapshot:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save snapshot';
      set({ versionsError: errorMessage });
      throw error;
    }
  },

  restoreVersionSnapshot: async (versionId) => {
    const { activeDashboardId } = get();
    if (!activeDashboardId) return;
    try {
      const full = await chartService.getVersion(activeDashboardId, versionId);
      // Save current state as a recovery point first
      await get().saveVersionSnapshot(`Before restore — ${new Date().toLocaleString()}`);
      const widgets = (full.widgets ?? []) as unknown as WidgetInstance[];
      const layout = (full.layout ?? []) as unknown as LayoutItem[];
      set((state) => {
        const dashboards = state.dashboards.map((d) =>
          d.id === activeDashboardId ? { ...d, widgets, layout } : d
        );
        return { widgets, layout, dashboards, selectedWidgetId: null };
      });
    } catch (error) {
      console.error(`Failed to restore version ${versionId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to restore version';
      set({ versionsError: errorMessage });
      throw error;
    }
  },

  deleteVersionSnapshot: async (versionId) => {
    const { activeDashboardId } = get();
    if (!activeDashboardId) return;
    try {
      await chartService.deleteVersion(activeDashboardId, versionId);
      set((state) => ({
        dashboardVersions: state.dashboardVersions.filter((v) => v.id !== versionId),
      }));
    } catch (error) {
      console.error(`Failed to delete version ${versionId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete snapshot';
      set({ versionsError: errorMessage });
      throw error;
    }
  },
}));
