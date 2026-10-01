/**
 * Editing on the chart itself (Canva / Datawrapper): the chart and the card report what was
 * clicked or typed, and the Properties panel — which knows the selected widget and how to save
 * it — applies it. Saving is the panel's normal path: on screen at once, stored shortly after.
 */

/** A click on the chart canvas: an axis title, or a data point (bar, slice, point). */
export const CHART_CLICK_EVENT = 'aicser-chart-click';
/** A change typed straight into the card (description, source) for one widget. */
export const WIDGET_OPTIONS_PATCH_EVENT = 'aicser-widget-options-patch';

export type ChartClickDetail = {
  widgetId: string;
  kind: 'axisTitle' | 'point';
  axis?: 'x' | 'y';
  /** The category clicked (raw value), for points. */
  category?: string;
  /** Page coordinates of the click, to place the editor. */
  clientX: number;
  clientY: number;
};

export type WidgetOptionsPatchDetail = { widgetId: string; patch: Record<string, unknown> };

export function emitWidgetOptionsPatch(widgetId: string, patch: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent<WidgetOptionsPatchDetail>(WIDGET_OPTIONS_PATCH_EVENT, { detail: { widgetId, patch } }));
}
