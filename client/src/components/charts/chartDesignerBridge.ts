import type { ChartData } from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';
import type {
  ChartDesignerWidget,
  LayoutItem,
} from '@/app/(dashboard)/chart-designer/stores/useChartDesignerStore';
import { rawChartConfig } from '@/components/charts/hydrateChartConfig';
import { removeWatermarkFromChart } from '@/utils/watermark';
import {
  buildChatChartPinPayload,
  type ChatMessagePinSource,
} from '@/components/charts/buildChatChartPinPayload';
import type { SharedChartProps } from '@/components/charts/echartsToSharedWidget';
import {
  isDashboardChartType,
  normalizeDashboardChartType,
} from '@/app/(dashboard)/dashboards/utils/filterConfigMerge';

export const CHART_DESIGNER_SELECT_KEY = 'chart_designer_select';
export const TEMP_CHART_DATA_KEY = 'temp_chart_data';
export const CHART_DESIGNER_PENDING_IMPORT_KEY = 'chart_designer_pending_import';

export type PendingChartDesignerImport = {
  chartId: string;
  widget: ChartDesignerWidget;
  chartData?: ChartData | null;
};

/** True when query-backed chart data has rows/series to render (empty arrays should not block snapshots). */
export function hasRenderableChartData(data: unknown): boolean {
  if (data == null) return false;
  if (typeof data !== 'object') return true;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.x) && d.x.length > 0) return true;
  if (Array.isArray(d.y) && d.y.length > 0) return true;
  if (Array.isArray(d.series) && d.series.length > 0) return true;
  if (Array.isArray(data) && data.length > 0) return true;
  return false;
}

/** Map ECharts styling back to chart-designer property panel options. */
export function extractDesignerOptionsFromConfig(config: unknown): Record<string, unknown> {
  const cfg = rawChartConfig(config);
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const seriesType = String(series[0]?.type || 'bar');
  const designerOptions: Record<string, unknown> = {};

  if (seriesType === 'bar') {
    const xAxis = Array.isArray(cfg.xAxis) ? cfg.xAxis[0] : cfg.xAxis;
    const yAxis = Array.isArray(cfg.yAxis) ? cfg.yAxis[0] : cfg.yAxis;
    if ((yAxis as Record<string, unknown>)?.type === 'category' || (xAxis as Record<string, unknown>)?.type === 'value') {
      designerOptions.barChartType = 'horizontal';
    } else {
      designerOptions.barChartType = 'vertical';
    }
    if (series.some((s) => s.type === 'line')) {
      designerOptions.barChartType = 'combo-line';
    }
    if (series[0]?.stack === 'total') {
      designerOptions.barStackMode = 'stacked';
    }
  } else if (seriesType === 'line') {
    if (series.some((s) => s.areaStyle)) {
      designerOptions.lineChartType = 'area';
    } else if (series[0]?.smooth) {
      designerOptions.lineChartType = 'smooth';
    } else if (series[0]?.step) {
      designerOptions.lineChartType = 'step';
    }
  } else if (seriesType === 'pie') {
    const radius = series[0]?.radius;
    if (Array.isArray(radius) && radius.length > 1) {
      const innerRadius = parseFloat(String(radius[0]));
      if (innerRadius > 0) {
        designerOptions.innerRadius = String(radius[0]).endsWith('%')
          ? parseInt(String(radius[0]), 10)
          : innerRadius;
      }
    }
  }

  designerOptions.showLegend = (cfg.legend as Record<string, unknown> | undefined)?.show !== false;
  designerOptions.showDataLabel = !!(series[0]?.label as Record<string, unknown> | undefined)?.show;
  designerOptions.showAxis = (cfg.xAxis as Record<string, unknown> | undefined)?.show !== false;
  designerOptions.showGridline = true;

  if (Array.isArray(cfg.color) && cfg.color.length > 0) {
    designerOptions.colorPalette = 'custom';
    designerOptions.customPalette = cfg.color;
    designerOptions.customColor = cfg.color[0];
  } else if (series[0]?.itemStyle && typeof (series[0].itemStyle as Record<string, unknown>).color === 'string') {
    designerOptions.colorPalette = 'custom';
    designerOptions.customColor = (series[0].itemStyle as Record<string, unknown>).color;
  }

  const xAxis = Array.isArray(cfg.xAxis) ? cfg.xAxis[0] : cfg.xAxis;
  const yAxis = Array.isArray(cfg.yAxis) ? cfg.yAxis[0] : cfg.yAxis;
  if ((xAxis as Record<string, unknown>)?.name) {
    designerOptions.xAxisLabel = (xAxis as Record<string, unknown>).name;
  }
  if ((yAxis as Record<string, unknown>)?.name) {
    designerOptions.yAxisLabel = (yAxis as Record<string, unknown>).name;
  }

  return designerOptions;
}

/** Safely clone an object, dropping functions and breaking circular refs. */
function safeClone<T>(obj: T): T {
  const seen = new WeakSet();
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'function') return undefined;
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }),
  );
}

/**
 * Strip render-only fields and watermark graphics before persisting to the API.
 *
 * __prefetchedChartData is intentionally KEPT (previously stripped here) — it's
 * the only durable copy of a chat-originated chart's row data once the sessionStorage
 * side-channel (storeTempChartData) is consumed on first read. Stripping it meant any
 * reload/refetch of the saved chart had no data to hydrate from and fell back to
 * shouldFetchDesignerChartData's executeAdhoc re-fetch, which for chat charts uses a
 * chartQuery that's frequently just {tableName:'data', filters:[]} and can't actually
 * reconstruct anything — the chart went blank on reload. mapApiChartToDesignerWidget
 * already round-trips chartOptions back onto the widget, so keeping this field here is
 * sufficient for the existing read path to pick it back up.
 */
export function prepareChartOptionsForPersist(
  chartOptions: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!chartOptions || typeof chartOptions !== 'object') return {};

  // Drop client-only transient fields before cloning (__prefetchedChartData is NOT
  // transient — see function doc — so it stays in `rest` and gets persisted)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { __animate: _anim, ...rest } = chartOptions;

  // Safe-clone the whole object to eliminate circular refs and functions
  let next: Record<string, unknown>;
  try {
    next = safeClone(rest);
  } catch {
    next = {};
  }

  if (next.__echartsSnapshot && typeof next.__echartsSnapshot === 'object') {
    next.__echartsSnapshot = removeWatermarkFromChart(
      next.__echartsSnapshot as Parameters<typeof removeWatermarkFromChart>[0],
    );
  }

  return next;
}

export function prepareChartQueryForPersist(
  chartQuery: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!chartQuery || typeof chartQuery !== 'object') {
    return { tableName: 'data', filters: [] };
  }
  const next = { ...chartQuery };
  if (!Array.isArray(next.filters)) next.filters = [];
  return next;
}

/** Normalize widget fields for POST /api/chart (standalone save) — mirrors pin-to-dashboard payload. */
export function buildStandaloneChartSavePayload(widget: ChartDesignerWidget): {
  title: string;
  chartType: string;
  chartQuery: Record<string, unknown>;
  chartOptions: Record<string, unknown>;
  dataSourceId?: string;
} {
  const chartType = normalizeDashboardChartType(
    widget.chartType && isDashboardChartType(widget.chartType) ? widget.chartType : 'bar',
  );
  const payload: {
    title: string;
    chartType: string;
    chartQuery: Record<string, unknown>;
    chartOptions: Record<string, unknown>;
    dataSourceId?: string;
  } = {
    title: (widget.title || 'Chart from chat').trim() || 'Chart from chat',
    chartType,
    chartQuery: prepareChartQueryForPersist(widget.chartQuery),
    chartOptions: prepareChartOptionsForPersist(widget.chartOptions),
  };
  if (widget.dataSourceId && String(widget.dataSourceId).trim()) {
    payload.dataSourceId = String(widget.dataSourceId).trim();
  }
  return payload;
}

export function storeTempChartData(chartId: string, data: ChartData): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      TEMP_CHART_DATA_KEY,
      JSON.stringify({ chartId: String(chartId), data }),
    );
  } catch {
    // ignore quota errors
  }
}

export function readTempChartData(chartId: string | null | undefined): ChartData | null {
  if (typeof window === 'undefined' || !chartId) return null;
  try {
    const raw = sessionStorage.getItem(TEMP_CHART_DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { chartId?: string; data?: ChartData };
    if (String(parsed.chartId) !== String(chartId)) return null;
    sessionStorage.removeItem(TEMP_CHART_DATA_KEY);
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function markChartDesignerSelection(chartId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(CHART_DESIGNER_SELECT_KEY, String(chartId));
}

/** Read pending chart id without clearing session (URL param takes precedence). */
export function peekPendingChartDesignerId(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('chart');
  const fromSession = sessionStorage.getItem(CHART_DESIGNER_SELECT_KEY);
  return fromUrl || fromSession;
}

export function clearPendingChartDesignerSelection(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CHART_DESIGNER_SELECT_KEY);
}

/** @deprecated Prefer peekPendingChartDesignerId + clearPendingChartDesignerSelection */
export function readPendingChartDesignerId(): string | null {
  const id = peekPendingChartDesignerId();
  if (id) clearPendingChartDesignerSelection();
  return id;
}

export function storePendingChartDesignerImport(payload: PendingChartDesignerImport): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHART_DESIGNER_PENDING_IMPORT_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

export function readPendingChartDesignerImport(
  expectedChartId?: string | null,
): PendingChartDesignerImport | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHART_DESIGNER_PENDING_IMPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChartDesignerImport;
    if (expectedChartId && String(parsed.chartId) !== String(expectedChartId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingChartDesignerImport(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CHART_DESIGNER_PENDING_IMPORT_KEY);
}

export function mapApiChartToDesignerWidget(
  c: Record<string, unknown>,
  userId: string,
): { widget: ChartDesignerWidget; layout: LayoutItem } {
  const chartId = String(c.id);
  const chartOptions =
    ((c.config as { options?: Record<string, unknown> } | undefined)?.options ??
      c.chartOptions ??
      {}) as Record<string, unknown>;
  const chartQuery =
    ((c.config as { query?: Record<string, unknown> } | undefined)?.query ??
      c.chartQuery ??
      {}) as Record<string, unknown>;
  const savedLayout =
    (c.layout as LayoutItem | undefined) ??
    (chartOptions.layout as LayoutItem | undefined);

  return {
    widget: {
      id: `w_saved_${chartId}`,
      chartId,
      dashboardId: (c.dashboard_id ?? c.dashboardId) as string | undefined,
      title: String(c.name ?? c.title ?? 'Untitled'),
      chartType: String(c.type ?? c.chartType ?? 'bar'),
      chartQuery,
      chartOptions,
      dataSourceId: (c.data_source_id ?? c.dataSourceId) as string | undefined,
      userId,
      isLoading: false,
    },
    layout: {
      i: `w_saved_${chartId}`,
      x: savedLayout?.x ?? 0,
      y: savedLayout?.y ?? 0,
      w: savedLayout?.w ?? 6,
      h: savedLayout?.h ?? 5,
    },
  };
}

export function hydrateDesignerWidget(
  widget: ChartDesignerWidget,
  chartId: string,
): ChartDesignerWidget {
  const tempData = readTempChartData(chartId);
  const pendingImport = readPendingChartDesignerImport(chartId);
  const chartData = tempData ?? pendingImport?.chartData ?? widget.chartData;
  return {
    ...widget,
    chartData: chartData ?? widget.chartData,
    isLoading: false,
  };
}

/** Apply temp/pending data and skip SQL refresh when an AI snapshot is present. */
export function shouldFetchDesignerChartData(widget: ChartDesignerWidget): boolean {
  if (!widget.dataSourceId || widget.chartData) return false;
  const options = widget.chartOptions ?? {};
  if (options.__echartsSnapshot) return false;
  if (hasRenderableChartData(options.__prefetchedChartData)) return false;
  return true;
}

export function buildDesignerWidgetFromChat(
  source: ChatMessagePinSource,
  options: {
    userId: string;
    title?: string;
    sharedChartProps?: SharedChartProps | null;
    dataSourceIdOverride?: string | null;
  },
): ChartDesignerWidget {
  const pinPayload = buildChatChartPinPayload(source, options.dataSourceIdOverride);
  const designerOptions = extractDesignerOptionsFromConfig(source.echartsConfig || source.chartConfig);
  const prefetched = options.sharedChartProps?.chartData;

  return {
    id: `w_temp_${Date.now()}`,
    title: options.title?.trim() || pinPayload.title,
    chartType: pinPayload.chartType,
    dataSourceId: pinPayload.dataSourceId ?? options.dataSourceIdOverride ?? undefined,
    chartQuery: pinPayload.chartQuery,
    chartOptions: {
      ...pinPayload.chartOptions,
      ...designerOptions,
      __source: 'ai_chat',
      ...(prefetched ? { __prefetchedChartData: prefetched } : {}),
    },
    chartData: prefetched,
    userId: options.userId,
  };
}
