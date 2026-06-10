import type { ChartQuery } from '@/app/(dashboard)/dashboards/services/chartService';
import { extractEchartsSnapshotOption, resolveChatChartDisplay } from '@/components/charts/resolveChatChart';
import {
  isDashboardChartType,
  normalizeDashboardChartType,
} from '@/app/(dashboard)/dashboards/utils/filterConfigMerge';

export interface ChatChartImportPayload {
  config?: Record<string, unknown>;
  title?: string;
  messageId?: string;
  semantic_bindings?: Record<string, unknown>;
  sqlQuery?: string;
  dataSourceId?: string | null;
  queryResult?: Record<string, unknown>[] | null;
}

export interface ChatMessagePinSource {
  echartsConfig?: unknown;
  chartConfig?: unknown;
  sqlQuery?: string;
  dataSourceId?: string | null;
  query?: string;
  title?: string;
  queryResult?: Record<string, unknown>[] | null;
  executionMetadata?: { chart_query?: Record<string, unknown> };
  ai_metadata?: { chart_query?: Record<string, unknown> };
}

function inferChartTypeFromConfig(config: Record<string, unknown>): string {
  const series = config.series as Array<{ type?: string; areaStyle?: unknown; stack?: string }> | undefined;
  const first = series?.[0];
  if (!first?.type) return 'bar';
  let chartType = String(first.type);
  if (chartType === 'line' && series?.some((s) => s.areaStyle)) chartType = 'area';
  if (chartType === 'pie') {
    const radius = (first as { radius?: unknown }).radius;
    if (Array.isArray(radius) && parseFloat(String(radius[0])) > 0) chartType = 'donut';
  }
  return chartType;
}

function normalizeChartQueryFromMeta(
  source: Record<string, unknown>,
  queryResult?: Record<string, unknown>[] | null,
): ChartQuery {
  const chartQuery: ChartQuery = {
    ...source,
    x: (source.x || source.xField || source.xAxis || source.x_axis) as string | undefined,
    yMetric: (source.yMetric || source.yField || source.metric || source.y_axis) as ChartQuery['yMetric'],
    sortBy: (source.sortBy as string) || 'x',
    sortOrder: (source.sortOrder as 'asc' | 'desc') || 'asc',
    filters: (source.filters as ChartQuery['filters']) || [],
    metricFilters: (source.metricFilters as ChartQuery['metricFilters']) || [],
  };

  if (queryResult?.length) {
    const cols = Object.keys(queryResult[0]);
    if (chartQuery.x) {
      const match = cols.find((c) => c.toLowerCase() === String(chartQuery.x).toLowerCase());
      if (match) chartQuery.x = match;
    }
    if (chartQuery.yMetric) {
      const match = cols.find((c) => c.toLowerCase() === String(chartQuery.yMetric).toLowerCase());
      if (match) chartQuery.yMetric = match;
    }
  }

  return chartQuery;
}

function resolveMetaChartQuery(
  source: ChatMessagePinSource | ChatChartImportPayload,
  queryResult?: Record<string, unknown>[] | null,
): ChartQuery | undefined {
  const importLike = source as ChatChartImportPayload;
  const messageLike = source as ChatMessagePinSource;
  const meta =
    importLike.semantic_bindings ||
    messageLike.executionMetadata?.chart_query ||
    messageLike.ai_metadata?.chart_query ||
    {};
  if (Object.keys(meta).length === 0) return undefined;
  return normalizeChartQueryFromMeta(meta, queryResult);
}

export function buildChatChartPinPayload(
  source: ChatMessagePinSource | ChatChartImportPayload,
  dataSourceIdOverride?: string | null,
): {
  chartType: string;
  title: string;
  chartQuery?: ChartQuery;
  chartOptions: Record<string, unknown>;
  dataSourceId: string | null;
} {
  const messageLike = source as ChatMessagePinSource;
  const importLike = source as ChatChartImportPayload;
  const rawConfig =
    (messageLike.echartsConfig || messageLike.chartConfig || importLike.config || {}) as Record<string, unknown>;
  const sqlQuery = messageLike.sqlQuery || importLike.sqlQuery;
  const queryResult = messageLike.queryResult || importLike.queryResult || null;
  const resolvedDs =
    dataSourceIdOverride ?? messageLike.dataSourceId ?? importLike.dataSourceId ?? null;

  const display = resolveChatChartDisplay(rawConfig, queryResult, messageLike);
  let chartType = inferChartTypeFromConfig(rawConfig);
  let chartQuery: ChartQuery | undefined;
  const chartOptions: Record<string, unknown> = {};

  if (sqlQuery?.trim()) {
    chartOptions.sample_sql = sqlQuery.trim();
  }

  if (display.mode === 'shared') {
    chartType = display.props.chartType;
    const sharedQuery = display.props.chartQuery as Record<string, unknown>;
    if (Object.keys(sharedQuery).length > 0) {
      chartQuery = normalizeChartQueryFromMeta(sharedQuery, queryResult);
    } else {
      chartQuery = resolveMetaChartQuery(source, queryResult);
      if (!chartQuery && sqlQuery?.trim()) {
        chartQuery = { tableName: 'data', filters: [] };
      }
    }
    Object.assign(chartOptions, display.props.chartOptions);
    if (display.props.chartData) {
      chartOptions.__prefetchedChartData = display.props.chartData;
    }
    chartOptions.__source = 'ai_chat';
  } else if (display.mode === 'echarts') {
    chartOptions.__echartsSnapshot = display.config;
    chartOptions.__source = 'ai_chat';
    chartQuery = resolveMetaChartQuery(source, queryResult);
    if (!chartQuery && sqlQuery?.trim()) {
      chartQuery = { tableName: 'data', filters: [] };
    }
  } else {
    chartQuery = resolveMetaChartQuery(source, queryResult);
    if (!chartQuery && sqlQuery?.trim()) {
      chartQuery = { tableName: 'data', filters: [] };
    }

    const canRefreshLive = Boolean(chartQuery && sqlQuery?.trim() && resolvedDs);
    if (!canRefreshLive) {
      const snapshot = extractEchartsSnapshotOption(rawConfig);
      if (snapshot) {
        chartOptions.__echartsSnapshot = snapshot;
        chartOptions.__source = 'ai_chat';
      }
    } else {
      chartOptions.__source = 'ai_chat';
    }
  }

  const title =
    importLike.title ||
    (typeof rawConfig.title === 'object' && rawConfig.title !== null
      ? String((rawConfig.title as { text?: string }).text || '')
      : String(rawConfig.title || '')) ||
    messageLike.query?.slice(0, 80) ||
    messageLike.title ||
    'Chart from chat';

  chartType = normalizeDashboardChartType(chartType);

  if (!isDashboardChartType(inferChartTypeFromConfig(rawConfig)) && !chartOptions.__echartsSnapshot) {
    const snapshot =
      display.mode === 'echarts'
        ? display.config
        : extractEchartsSnapshotOption(rawConfig);
    if (snapshot) {
      chartOptions.__echartsSnapshot = snapshot;
    }
  }

  if (!chartOptions.__echartsSnapshot && !chartOptions.__prefetchedChartData) {
    const snapshot = extractEchartsSnapshotOption(rawConfig);
    if (snapshot) {
      chartOptions.__echartsSnapshot = snapshot;
    }
  }

  return {
    chartType,
    title: title.trim() || 'Chart from chat',
    chartQuery,
    chartOptions,
    dataSourceId: resolvedDs,
  };
}

export const CHART_IMPORT_STORAGE_KEY = 'chart_to_import';

export function readChartImportFromSession(): ChatChartImportPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHART_IMPORT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChatChartImportPayload;
  } catch {
    return null;
  }
}

export function clearChartImportSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CHART_IMPORT_STORAGE_KEY);
}

/** Normalize a chat message object into a pin/customize source payload. */
export function buildChatMessagePinSource(message: {
  echartsConfig?: unknown;
  chartConfig?: unknown;
  sqlQuery?: string;
  sql?: string;
  queryResult?: Record<string, unknown>[] | null;
  data?: Record<string, unknown>[] | null;
  dataSourceId?: string | null;
  query?: string;
  title?: string;
  executionMetadata?: { chart_query?: Record<string, unknown> };
  ai_metadata?: { chart_query?: Record<string, unknown> };
}): ChatMessagePinSource {
  return {
    echartsConfig: message.echartsConfig || message.chartConfig,
    sqlQuery: message.sqlQuery || message.sql,
    queryResult: message.queryResult || message.data || null,
    dataSourceId: message.dataSourceId ?? null,
    query: message.query,
    title: message.title,
    executionMetadata: message.executionMetadata,
    ai_metadata: message.ai_metadata,
  };
}
