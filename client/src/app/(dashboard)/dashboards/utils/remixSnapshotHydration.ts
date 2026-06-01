import type { ChartData } from '../services/chartService';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import { partitionSeriesData } from './chartDataProcessing';

export type DashboardRemixConfig = {
  feedPostId?: string;
  sourceAuthorId?: string;
  referralCode?: string;
  snapshotVersion?: number;
};

export function remixConfigFromDashboard(
  config?: Record<string, unknown> | null,
): DashboardRemixConfig | null {
  const remix = config?.remix;
  if (!remix || typeof remix !== 'object') return null;
  const row = remix as Record<string, unknown>;
  const feedPostId = typeof row.feedPostId === 'string' ? row.feedPostId.trim() : '';
  if (!feedPostId) return null;
  return {
    feedPostId,
    sourceAuthorId: typeof row.sourceAuthorId === 'string' ? row.sourceAuthorId : undefined,
    referralCode: typeof row.referralCode === 'string' ? row.referralCode : undefined,
    snapshotVersion: typeof row.snapshotVersion === 'number' ? row.snapshotVersion : undefined,
  };
}

export function isRemixSnapshotWidget(widget: Pick<WidgetInstance, 'chartOptions'>): boolean {
  const opts = widget.chartOptions as Record<string, unknown> | undefined;
  return Boolean(opts?.feedRemix && opts?.snapshotChartData);
}

/** Apply frozen snapshot chart data from a Discover remix (skip live query until user reconnects). */
export function hydrateRemixWidget(widget: WidgetInstance): WidgetInstance {
  if (!isRemixSnapshotWidget(widget)) return widget;

  const opts = widget.chartOptions as Record<string, unknown>;
  const raw = opts.snapshotChartData;
  if (!raw || typeof raw !== 'object') {
    return { ...widget, isLoading: false, error: null };
  }

  const chartData = partitionSeriesData(raw as ChartData, widget);
  return {
    ...widget,
    chartData,
    isLoading: false,
    error: null,
  };
}

export function hydrateRemixWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.map((w) => hydrateRemixWidget(w));
}
