import { getBackendUrl } from '@/utils/backendUrl';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutItem, RuntimeFilter, WidgetInstance, WidgetType } from '../stores/useDashboardStore';
import { normalizeRuntimeFiltersForBackend } from './filterOperators';
import { parseEmbedErrorDetail } from '@/utils/embedMessaging';

export type EmbedWidgetPayload = {
  id: string;
  title?: string | null;
  type?: string;
  chart_option?: unknown;
  echarts_option?: unknown;
  chartQuery?: Record<string, unknown>;
  dataSourceId?: string | null;
  error?: string | null;
  success?: boolean;
};

export type EmbedGridLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page_id?: string;
};

export type EmbedDashboardPayload = {
  id: string;
  name: string;
  description?: string;
  widgets: EmbedWidgetPayload[];
  layout?: EmbedGridLayoutItem[];
  global_filters?: DashboardFilter[];
  config?: { global_filters?: DashboardFilter[]; default_page_id?: string };
};

export function normalizeEmbedWidget(w: EmbedWidgetPayload, dataUnavailableLabel: string): WidgetInstance {
  const option = w.echarts_option || w.chart_option;
  const config = typeof option === 'object' && option !== null ? (option as Record<string, unknown>) : {};
  const chartId = String(w.id).replace(/^widget-/, '');
  const widgetId = String(w.id).startsWith('widget-') ? String(w.id) : `widget-${chartId}`;
  const failed = w.success === false || Boolean(w.error);
  const hasLiveData =
    !failed &&
    Boolean(
      config.value !== undefined ||
        (Array.isArray(config.y) && config.y.length) ||
        (Array.isArray(config.series) && (config.series as unknown[]).length),
    );

  return {
    id: widgetId,
    chartId,
    dataSourceId: w.dataSourceId || undefined,
    title: w.title || '',
    chartType: (w.type || 'bar') as WidgetType,
    chartQuery: w.chartQuery as WidgetInstance['chartQuery'],
    chartOptions: config,
    chartData: hasLiveData ? (config as unknown as WidgetInstance['chartData']) : undefined,
    isLoading: false,
    error: failed ? w.error || dataUnavailableLabel : null,
  };
}

export function mapEmbedLayout(saved: EmbedGridLayoutItem[]): LayoutItem[] {
  return saved.map((item) => ({
    i: String(item.i).startsWith('widget-') ? String(item.i) : `widget-${item.i}`,
    x: item.x ?? 0,
    y: item.y ?? 0,
    w: item.w ?? 4,
    h: item.h ?? 5,
    ...(item.page_id ? { pageId: String(item.page_id) } : {}),
  }));
}

export async function fetchEmbedDashboardPayload(
  dashboardId: string,
  opts?: {
    token?: string;
    pageId?: string | null;
    runtimeFilters?: RuntimeFilter[];
  },
): Promise<EmbedDashboardPayload> {
  // Same-origin relative path in the browser — NOT `getBackendUrl()`'s raw
  // NEXT_PUBLIC_API_URL, which is meant to be a Docker-internal service
  // hostname (e.g. http://chat2chart-server:8000) for server-side use. An
  // embed page is loaded straight into a visitor's browser (often via
  // iframe on a third-party site), which can't resolve that hostname at
  // all — every embed fetch failed outright ("Failed to fetch") wherever
  // NEXT_PUBLIC_API_URL is set to an internal address, which self-hosted
  // deployments commonly do. Mirrors how fetchApi's API_URL already handles
  // this for the rest of the app.
  const base = typeof window !== 'undefined' ? '' : getBackendUrl();
  const params = new URLSearchParams();
  if (opts?.token) params.set('token', opts.token);
  if (opts?.pageId) params.set('page_id', opts.pageId);
  if (opts?.runtimeFilters?.length) {
    // Every other chartService entry point runs runtimeFilters through this
    // same normalization before sending (executeChartWithFilters,
    // refreshDashboardCharts, ...) — this one didn't, so a date-range filter
    // arrived at the backend still shaped as {operator:'between', value:[from,to]}
    // instead of split into >=/<= entries. merge_runtime_filters (operations.py)
    // has no 'between' handling, so it fell through to a literal equality
    // comparison against the array's string repr ("WHERE date = '[from, to]'"),
    // which DuckDB/Postgres reject as an invalid timestamp — the exact
    // "Data unavailable" seen only in full/preview (embed-payload) mode,
    // never in the normal dashboard-viewer path that already normalizes.
    const normalized = normalizeRuntimeFiltersForBackend(opts.runtimeFilters);
    if (normalized.length) {
      params.set('filters', encodeURIComponent(JSON.stringify(normalized)));
    }
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/dashboards/${dashboardId}/embed${qs}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(parseEmbedErrorDetail(detail, `Failed to load dashboard (${res.status})`));
  }
  return res.json() as Promise<EmbedDashboardPayload>;
}
