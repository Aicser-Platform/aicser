/**
 * Live dashboard studio state → ACC artifacts (complements server hydration from DB).
 */

import type { SurfaceContext } from '@/agent/surfaceContext';
import { buildDashboardSurfaceContext } from '@/agent/surfaceContext';
import { withSurfaceDataConnectivity } from '@/agent/surfaceDataConnectivity';

type WidgetLike = {
  id: string;
  title?: string;
  chartType?: string;
  chartId?: string;
  dataSourceId?: string;
  chartQuery?: Record<string, unknown>;
  chartOptions?: Record<string, unknown>;
};

type LayoutLike = { i: string; x?: number; y?: number; w?: number; h?: number };

export function summarizeDashboardWidgets(
  widgets: WidgetLike[],
  layout?: LayoutLike[],
): Array<Record<string, unknown>> {
  const layoutById = new Map((layout ?? []).map((l) => [l.i, l]));
  return widgets.map((w) => {
    const cq = w.chartQuery ?? {};
    const pos = layoutById.get(w.id);
    return {
      id: w.id,
      chart_id: w.chartId,
      title: w.title,
      chart_type: w.chartType,
      data_source_id: w.dataSourceId ?? cq.dataSourceId,
      table_name: cq.tableName,
      x_field: cq.x,
      y_metric: cq.yMetric,
      y_metrics: cq.yMetrics,
      filters: cq.filters,
      subtitle: w.chartOptions?.subtitle,
      layout: pos
        ? { x: pos.x, y: pos.y, w: pos.w, h: pos.h }
        : undefined,
    };
  });
}

export function buildDashboardStudioSurfaceContext(opts: {
  dashboardId: string;
  title?: string;
  intent?: SurfaceContext['intent'];
  widgetId?: string;
  filters?: unknown[];
  dataSourceId?: string;
  widgets: WidgetLike[];
  layout?: LayoutLike[];
}): SurfaceContext {
  const base = buildDashboardSurfaceContext({
    dashboardId: opts.dashboardId,
    title: opts.title,
    widgetId: opts.widgetId,
    intent: opts.intent,
    filters: opts.filters,
    dataSourceId: opts.dataSourceId,
  });
  return withSurfaceDataConnectivity({
    ...base,
    artifacts: {
      widgets: summarizeDashboardWidgets(opts.widgets, opts.layout),
    },
  });
}
