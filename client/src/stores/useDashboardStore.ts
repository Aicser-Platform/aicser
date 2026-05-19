import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { Widget } from '@/types/dashboard';

interface DashboardState {
    // State
    widgets: Widget[];
    selectedWidgetIds: string[];
    isDragging: boolean;
    clipboard: Widget | null;

    // Selectors (memoized)
    getWidget: (id: string) => Widget | undefined;
    getSelectedWidgets: () => Widget[];

    // Actions
    addWidget: (widget: Widget) => void;
    updateWidget: (id: string, updates: Partial<Widget>) => void;
    removeWidget: (id: string) => void;
    selectWidget: (id: string, multi?: boolean) => void;
    deselectAll: () => void;
    copyWidget: (id: string) => void;
    pasteWidget: () => void;
    duplicateWidget: (id: string) => void;

    // Layout
    updateLayout: (layout: any[]) => void;

    // Collaboration
    applyRemoteUpdate: (update: any) => void;
}

export const useDashboardStore = create<DashboardState>()(
    devtools(
        temporal(
            immer((set, get) => ({
                widgets: [],
                selectedWidgetIds: [],
                isDragging: false,
                clipboard: null,

                // Selectors
                getWidget: (id: string) =>
                    get().widgets.find((w: Widget) => w.id === id),

                getSelectedWidgets: () => {
                    const { widgets, selectedWidgetIds } = get();
                    return widgets.filter((w: Widget) =>
                        selectedWidgetIds.includes(w.id)
                    );
                },

                // Actions
                addWidget: (widget: Widget) =>
                    set((state: DashboardState) => {
                        state.widgets.push(widget);
                        console.log('➕ Adding new widget:', widget);
                    }),

                updateWidget: (id: string, updates: Partial<Widget>) =>
                    set((state: DashboardState) => {
                        const widget = state.widgets.find(
                            (w: Widget) => w.id === id
                        );
                        if (widget) {
                            Object.assign(widget, updates);
                        }
                    }),

                removeWidget: (id: string) =>
                    set((state: DashboardState) => {
                        state.widgets = state.widgets.filter(
                            (w: Widget) => w.id !== id
                        );
                        state.selectedWidgetIds =
                            state.selectedWidgetIds.filter(
                                (wid: string) => wid !== id
                            );
                    }),

                selectWidget: (id: string, multi = false) =>
                    set((state: DashboardState) => {
                        if (multi) {
                            if (!state.selectedWidgetIds.includes(id)) {
                                state.selectedWidgetIds.push(id);
                            }
                        } else {
                            state.selectedWidgetIds = [id];
                        }
                    }),

                deselectAll: () =>
                    set((state: DashboardState) => {
                        state.selectedWidgetIds = [];
                    }),

                copyWidget: (id: string) =>
                    set((state: DashboardState) => {
                        const widget = state.widgets.find(
                            (w: Widget) => w.id === id
                        );
                        if (widget) {
                            state.clipboard = { ...widget };
                        }
                    }),

                pasteWidget: () =>
                    set((state: DashboardState) => {
                        if (state.clipboard) {
                            const newWidget = {
                                ...state.clipboard,
                                id: `widget-${Date.now()}`,
                                position: {
                                    ...state.clipboard.position,
                                    x: state.clipboard.position.x + 1,
                                    y: state.clipboard.position.y + 1,
                                },
                            };
                            state.widgets.push(newWidget);
                        }
                    }),

                duplicateWidget: (id: string) =>
                    set((state: DashboardState) => {
                        const widget = state.widgets.find(
                            (w: Widget) => w.id === id
                        );
                        if (widget) {
                            const duplicate = {
                                ...widget,
                                id: `widget-${Date.now()}`,
                                position: {
                                    ...widget.position,
                                    x: widget.position.x + 1,
                                    y: widget.position.y + 1,
                                },
                            };
                            state.widgets.push(duplicate);
                        }
                    }),

                updateLayout: (layout: any[]) =>
                    set((state: DashboardState) => {
                        layout.forEach((item: any) => {
                            const widget = state.widgets.find(
                                (w: Widget) => w.id === item.i
                            );
                            if (widget) {
                                widget.position = {
                                    x: item.x,
                                    y: item.y,
                                    w: item.w,
                                    h: item.h,
                                };
                            }
                        });
                    }),

                applyRemoteUpdate: (update: any) =>
                    set((state: DashboardState) => {
                        switch (update.type) {
                            case 'widget:add':
                                state.widgets.push(update.widget);
                                break;
                            case 'widget:update':
                                const widget = state.widgets.find(
                                    (w: Widget) => w.id === update.id
                                );
                                if (widget) {
                                    Object.assign(widget, update.changes);
                                }
                                break;
                            case 'widget:remove':
                                state.widgets = state.widgets.filter(
                                    (w: Widget) => w.id !== update.id
                                );
                                break;
                        }
                    }),

            })),
            {
                limit: 50, // Limit history to 50 actions
                partialize: (state: DashboardState) => ({
                    widgets: state.widgets,
                    selectedWidgetIds: state.selectedWidgetIds,
                }),
            }
        )
    )
);

// Undo/redo actions (provided by zundo)
export const useUndo = () => useDashboardStore.temporal.getState().undo;
export const useRedo = () => useDashboardStore.temporal.getState().redo;
export const useCanUndo = () =>
    useDashboardStore.temporal.getState().pastStates.length > 0;
export const useCanRedo = () =>
    useDashboardStore.temporal.getState().futureStates.length > 0;
