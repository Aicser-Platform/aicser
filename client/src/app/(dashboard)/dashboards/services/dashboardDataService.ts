import { chartService } from './chartService';
import { partitionSeriesData } from '../utils/chartDataProcessing';
import { buildDrillContext } from '../utils/drillDownHelpers';
import { mergeFilterConfigs } from '../utils/filterConfigMerge';
import { resolveRuntimeFiltersForWidget, type RuntimeFilter } from '../utils/filterOperators';
import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance, WidgetDrillState } from '../stores/useDashboardStore';

export type ChartAccessOpts = { embedToken?: string };

export function studioFilterConfigs(
  globalFilters: DashboardFilter[],
  pageFilters: DashboardFilter[],
): DashboardFilter[] {
  return mergeFilterConfigs(globalFilters, pageFilters);
}

export function scopedRuntimeFiltersForWidget(
  widget: WidgetInstance,
  runtimeFilters: RuntimeFilter[],
  filterConfigs: DashboardFilter[],
): RuntimeFilter[] {
  return resolveRuntimeFiltersForWidget(runtimeFilters, filterConfigs, widget);
}

/** Fetch processed chart data for one widget. */
export async function fetchWidgetChartData(params: {
  dashboardId: string;
  widget: WidgetInstance;
  runtimeFilters: RuntimeFilter[];
  filterConfigs: DashboardFilter[];
  drillState?: WidgetDrillState | null;
  accessOpts?: ChartAccessOpts;
}) {
  const { dashboardId, widget, runtimeFilters, filterConfigs, drillState, accessOpts } = params;
  if (!widget.chartId) {
    throw new Error('Widget has no chartId');
  }

  const scoped = scopedRuntimeFiltersForWidget(widget, runtimeFilters, filterConfigs);
  const drillContext = buildDrillContext(widget, drillState ?? null);

  const response =
    scoped.length > 0 || drillContext
      ? await chartService.executeChartWithFilters(dashboardId, widget.chartId, scoped, {
          drillContext,
          ...accessOpts,
        })
      : await chartService.executeChart(dashboardId, widget.chartId, accessOpts);

  return {
    chartData: partitionSeriesData(response.data, widget),
    chartOptions: response.chart?.chartOptions as Record<string, unknown> | undefined,
  };
}

export function buildBatchRefreshItems(
  widgets: WidgetInstance[],
  runtimeFilters: RuntimeFilter[],
  filterConfigs: DashboardFilter[],
  drillStateByWidget: Record<string, WidgetDrillState | undefined> = {},
) {
  return widgets
    .filter((w) => w.chartId)
    .map((w) => ({
      chart_id: w.chartId!,
      widget_id: w.id,
      runtime_filters: scopedRuntimeFiltersForWidget(w, runtimeFilters, filterConfigs),
      drill_context: buildDrillContext(w, drillStateByWidget[w.id]),
    }));
}

/** Batch refresh chart data for multiple widgets. */
export async function refreshWidgetsBatchData(params: {
  dashboardId: string;
  widgets: WidgetInstance[];
  runtimeFilters: RuntimeFilter[];
  filterConfigs: DashboardFilter[];
  drillStateByWidget?: Record<string, WidgetDrillState | undefined>;
  accessOpts?: ChartAccessOpts;
}) {
  const items = buildBatchRefreshItems(
    params.widgets,
    params.runtimeFilters,
    params.filterConfigs,
    params.drillStateByWidget,
  );
  return chartService.refreshDashboardCharts(params.dashboardId, items, params.accessOpts);
}
