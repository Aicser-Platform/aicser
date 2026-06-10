import type { StateCreator } from 'zustand';
import { readStudioMode, writeStudioMode } from '../../utils/studioModeStorage';
import type { StudioMode } from '../dashboardStoreTypes';

export type DashboardUiSlice = {
  isSidebarCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  isSaving: boolean;
  activeLeftTab: string;
  isFullscreen: boolean;
  studioMode: StudioMode;
  canvasZoom: number;
  selectedWidgetIds: Set<string>;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setPropertiesCollapsed: (collapsed: boolean) => void;
  setActiveLeftTab: (tab: string) => void;
  setSaving: (saving: boolean) => void;
  setIsFullscreen: (full: boolean) => void;
  setCanvasZoom: (zoom: number) => void;
  setStudioMode: (mode: StudioMode) => void;
  toggleWidgetInSelection: (id: string) => void;
  clearMultiSelection: () => void;
};

type StoreWithUi = DashboardUiSlice & {
  activeDashboardId: string | null;
  selectedWidgetId: string | null;
};

export const createDashboardUiSlice: StateCreator<StoreWithUi, [], [], DashboardUiSlice> = (set, get) => ({
  isSidebarCollapsed: false,
  isPropertiesCollapsed: true,
  isSaving: false,
  activeLeftTab: 'library',
  isFullscreen: false,
  studioMode: 'edit' as StudioMode,
  canvasZoom: 100,
  selectedWidgetIds: new Set<string>(),

  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  setPropertiesCollapsed: (collapsed) => set({ isPropertiesCollapsed: collapsed }),
  setActiveLeftTab: (tab) => set({ activeLeftTab: tab }),
  setSaving: (saving) => set({ isSaving: saving }),
  setIsFullscreen: (full) => set({ isFullscreen: full }),
  setCanvasZoom: (zoom) => set({ canvasZoom: Math.min(200, Math.max(25, zoom)) }),

  toggleWidgetInSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedWidgetIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedWidgetIds: next };
    }),

  clearMultiSelection: () => set({ selectedWidgetIds: new Set<string>() }),

  setStudioMode: (mode) => {
    const activeId = get().activeDashboardId;
    writeStudioMode(activeId, mode);
    set({
      studioMode: mode,
      selectedWidgetId: mode === 'view' ? null : get().selectedWidgetId,
      isPropertiesCollapsed: mode === 'view' ? true : get().isPropertiesCollapsed,
    });
  },
});
