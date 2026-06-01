import { getBackendUrl } from '@/utils/backendUrl';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutItem, RuntimeFilter, WidgetInstance, WidgetType } from '../stores/useDashboardStore';

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
  const base = getBackendUrl();
  const params = new URLSearchParams();
  if (opts?.token) params.set('token', opts.token);
  if (opts?.pageId) params.set('page_id', opts.pageId);
  if (opts?.runtimeFilters?.length) {
    params.set('filters', encodeURIComponent(JSON.stringify(opts.runtimeFilters)));
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/dashboards/${dashboardId}/embed${qs}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : 'Failed to load dashboard');
  }
  return res.json() as Promise<EmbedDashboardPayload>;
}
