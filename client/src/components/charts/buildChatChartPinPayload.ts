import type { ChartQuery } from '@/app/(dashboard)/dashboards/services/chartService';
import { extractEchartsSnapshotOption, resolveChatChartDisplay } from '@/components/charts/resolveChatChart';
import {
  isDashboardChartType,
  normalizeDashboardChartType,
} from '@/app/(dashboard)/dashboards/utils/filterConfigMerge';
import {
  categoriesFromEchartsConfig,
  extractBarOrientationOptions,
  measureHintsFromEchartsConfig,
  promoteChartQueryToMultiMetrics,
} from '@/components/charts/normalizeMultiMetricChartQuery';

export interface ChatChartImportPayload {
  config?: Record<string, unknown>;
  title?: string;
  messageId?: string;
  semantic_bindings?: Record<string, unknown>;
  sqlQuery?: string;
  dataSourceId?: string | null;
  queryResult?: Record<string, unknown>[] | null;
  /** Durable library chart id when already materialized from this message */
  libraryChartId?: string | null;
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
  /** Chat message id — used to remember library chart after first pin/customize */
  messageId?: string;
  /** Existing library chart from a prior pin/customize of this message */
  libraryChartId?: string | null;
}

function inferChartTypeFromConfig(config: Record<string, unknown>): string {
  if (config.aiserWidgetType === 'stat') return 'stat';
  const series = config.series as Array<{ type?: string; areaStyle?: unknown; stack?: string }> | undefined;
  const first = series?.[0];
  if (!first?.type) return 'bar';
  let chartType = String(first.type);
  if (chartType === 'line' && series?.some((s) => s.areaStyle)) chartType = 'area';
  if (chartType === 'pie') {
    const radius = (first as { radius?: unknown }).radius;
    if (Array.isArray(radius) && parseFloat(String(radius[0])) > 0) chartType = 'donut';
  }
  if (chartType === 'gauge' || chartType === 'stat') return 'stat';
  return chartType;
}

function normalizeChartQueryFromMeta(
  source: Record<string, unknown>,
  queryResult?: Record<string, unknown>[] | null,
  echartsConfig?: Record<string, unknown> | null,
): ChartQuery {
  return promoteChartQueryToMultiMetrics(source, {
    queryResult,
    measureHints: measureHintsFromEchartsConfig(echartsConfig),
  });
}

function resolveMetaChartQuery(
  source: ChatMessagePinSource | ChatChartImportPayload,
  queryResult?: Record<string, unknown>[] | null,
  echartsConfig?: Record<string, unknown> | null,
): ChartQuery | undefined {
  const importLike = source as ChatChartImportPayload;
  const messageLike = source as ChatMessagePinSource;
  const meta =
    importLike.semantic_bindings ||
    messageLike.executionMetadata?.chart_query ||
    messageLike.ai_metadata?.chart_query ||
    {};
  if (Object.keys(meta).length === 0 && !queryResult?.length && !echartsConfig) return undefined;
  return normalizeChartQueryFromMeta(meta as Record<string, unknown>, queryResult, echartsConfig);
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
  const chartOptions: Record<string, unknown> = {
    ...extractBarOrientationOptions(rawConfig),
  };

  if (sqlQuery?.trim()) {
    chartOptions.sample_sql = sqlQuery.trim();
  }

  if (display.mode === 'shared') {
    chartType = display.props.chartType;
    const sharedQuery = display.props.chartQuery as Record<string, unknown>;
    if (Object.keys(sharedQuery).length > 0) {
      chartQuery = normalizeChartQueryFromMeta(sharedQuery, queryResult, rawConfig);
    } else {
      chartQuery = resolveMetaChartQuery(source, queryResult, rawConfig);
      if (!chartQuery && sqlQuery?.trim()) {
        chartQuery = promoteChartQueryToMultiMetrics(
          { filters: [] },
          { queryResult },
        );
      }
    }
    Object.assign(chartOptions, display.props.chartOptions, extractBarOrientationOptions(rawConfig));
    if (display.props.chartData) {
      chartOptions.__prefetchedChartData = display.props.chartData;
    }
    chartOptions.__source = 'ai_chat';
  } else if (display.mode === 'echarts') {
    chartOptions.__echartsSnapshot = display.config;
    chartOptions.__source = 'ai_chat';
    chartQuery = resolveMetaChartQuery(source, queryResult, rawConfig);
    if (!chartQuery && sqlQuery?.trim()) {
      chartQuery = promoteChartQueryToMultiMetrics({ filters: [] }, { queryResult });
    }
  } else {
    chartQuery = resolveMetaChartQuery(source, queryResult, rawConfig);
    if (!chartQuery && sqlQuery?.trim()) {
      chartQuery = promoteChartQueryToMultiMetrics({ filters: [] }, { queryResult });
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

  if (chartQuery) {
    chartQuery = promoteChartQueryToMultiMetrics(chartQuery as Record<string, unknown>, {
      queryResult,
      measureHints: [
        ...measureHintsFromEchartsConfig(rawConfig),
        ...((chartQuery.yMetrics || []).map((m) => m.field) || []),
      ],
    });
    // SQL-bound pin: never leave a phantom physical table (e.g. tableName: 'data').
    if (sqlQuery?.trim()) {
      const cleaned = { ...(chartQuery as Record<string, unknown>) };
      delete cleaned.tableName;
      cleaned.joins = [];
      if (!cleaned.yMetric) cleaned.yMetric = 'none';
      chartQuery = cleaned as ChartQuery;
    }
    const qOpts = chartQuery as Record<string, unknown>;
    if (qOpts.barChartType === 'horizontal') {
      chartOptions.barChartType = 'horizontal';
    }
  } else if (queryResult?.length) {
    chartQuery = promoteChartQueryToMultiMetrics(
      {},
      { queryResult, measureHints: measureHintsFromEchartsConfig(rawConfig) },
    );
    if (sqlQuery?.trim()) {
      const cleaned = { ...(chartQuery as Record<string, unknown>) };
      delete cleaned.tableName;
      cleaned.joins = [];
      chartQuery = cleaned as ChartQuery;
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

  if (chartOptions.barChartType === 'horizontal' && chartOptions.__prefetchedChartData) {
    const cats = categoriesFromEchartsConfig(rawConfig);
    const prefetch = chartOptions.__prefetchedChartData as { x?: unknown[] };
    if (
      cats.length &&
      (!prefetch.x ||
        prefetch.x.length === 0 ||
        prefetch.x.every((v) => /^\d+$/.test(String(v))))
    ) {
      chartOptions.__prefetchedChartData = { ...prefetch, x: cats };
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
/** messageId → library chart id (survives re-pin / customize of the same answer) */
export const CHAT_LIBRARY_CHART_MAP_KEY = 'aicser:chat-library-charts';

export function rememberChatLibraryChart(messageId: string | undefined | null, chartId: string): void {
  if (typeof window === 'undefined' || !messageId || !chartId) return;
  try {
    const raw = sessionStorage.getItem(CHAT_LIBRARY_CHART_MAP_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[String(messageId)] = String(chartId);
    sessionStorage.setItem(CHAT_LIBRARY_CHART_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function peekChatLibraryChart(messageId: string | undefined | null): string | null {
  if (typeof window === 'undefined' || !messageId) return null;
  try {
    const raw = sessionStorage.getItem(CHAT_LIBRARY_CHART_MAP_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    const id = map[String(messageId)];
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

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

export function storeChartImportSession(payload: ChatChartImportPayload): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHART_IMPORT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

/** Normalize a chat message object into a pin/customize source payload. */
export function buildChatMessagePinSource(message: {
  id?: string;
  messageId?: string;
  echartsConfig?: unknown;
  chartConfig?: unknown;
  sqlQuery?: string;
  sql?: string;
  queryResult?: Record<string, unknown>[] | null;
  data?: Record<string, unknown>[] | null;
  dataSourceId?: string | null;
  query?: string;
  title?: string;
  libraryChartId?: string | null;
  chartId?: string | null;
  executionMetadata?: { chart_query?: Record<string, unknown> };
  ai_metadata?: { chart_query?: Record<string, unknown> };
}): ChatMessagePinSource {
  const messageId = message.messageId || message.id;
  const remembered = peekChatLibraryChart(messageId);
  return {
    echartsConfig: message.echartsConfig || message.chartConfig,
    sqlQuery: message.sqlQuery || message.sql,
    queryResult: message.queryResult || message.data || null,
    dataSourceId: message.dataSourceId ?? null,
    query: message.query,
    title: message.title,
    executionMetadata: message.executionMetadata,
    ai_metadata: message.ai_metadata,
    messageId: messageId ? String(messageId) : undefined,
    libraryChartId:
      message.libraryChartId ||
      message.chartId ||
      remembered ||
      null,
  };
}
