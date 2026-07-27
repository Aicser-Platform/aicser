import type { SharedChartProps } from '@/components/charts/echartsToSharedWidget';
import { resolveSharedChartProps } from '@/components/charts/echartsToSharedWidget';
import type { ChartData } from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';

export type ChatChartDisplay =
  | { mode: 'shared'; props: SharedChartProps }
  | { mode: 'echarts'; config: Record<string, unknown> }
  | { mode: 'none' };

function rawConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {};
  const c = config as Record<string, unknown>;
  if (c.primary_chart && typeof c.primary_chart === 'object') {
    return c.primary_chart as Record<string, unknown>;
  }
  return c;
}

/** Resolve frozen ECharts option from chartOptions (snapshot wrapper or native series config). */
export function extractEchartsSnapshotOption(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!config || typeof config !== 'object') return null;
  const wrapped = config.__echartsSnapshot;
  if (wrapped && typeof wrapped === 'object') {
    return wrapped as Record<string, unknown>;
  }
  const cfg = rawConfig(config);
  const series = cfg.series;
  if (Array.isArray(series) && series.length > 0) {
    return cfg;
  }
  return null;
}

/** Detect animated chart payloads that must use raw ECharts (bar race, line race, etc.). */
export function getAnimMeta(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const anim = c.__animate ?? (c.primary_chart as Record<string, unknown> | undefined)?.__animate;
  return anim && typeof anim === 'object' ? (anim as Record<string, unknown>) : null;
}

/** Shared resolution for dashboard chat and embed chat. */
export function resolveChatChartDisplay(
  config: unknown,
  queryResult: Record<string, unknown>[] | null | undefined,
  message?: unknown,
): ChatChartDisplay {
  if (!config) return { mode: 'none' };
  if (getAnimMeta(config)) {
    return { mode: 'echarts', config: rawConfig(config) };
  }
  const shared = resolveSharedChartProps(config, queryResult, message);
  if (shared) {
    return { mode: 'shared', props: shared };
  }
  const cfg = rawConfig(config);
  if (cfg.series) {
    return { mode: 'echarts', config: cfg };
  }
  // resolveSharedChartProps only builds the {x,y,series} aggregation shape, so it
  // returns null for a table-typed chart (or anything else it doesn't recognize) even
  // when there's perfectly good row data to show. Without this, every caller of this
  // resolver — buildChatChartPinPayload (Pin to Dashboard) included — silently dropped
  // the query result for tables instead of carrying it through as chartData, same class
  // of bug already fixed for the Chart Designer handoff in ChartMessage.tsx.
  if (Array.isArray(queryResult) && queryResult.length > 0) {
    return {
      mode: 'shared',
      props: {
        chartType: 'table',
        chartData: queryResult as unknown as ChartData,
        chartOptions: {},
        chartQuery: {},
      },
    };
  }
  return { mode: 'none' };
}

/** Default animation options aligned with dashboard ChartMessage. */
export const CHART_ANIMATION_DEFAULTS = {
  animation: true,
  animationDuration: 800,
  animationEasing: 'cubicOut',
} as const;

export function withChartAnimationDefaults(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.__animate || (config.primary_chart as Record<string, unknown> | undefined)?.__animate) {
    return config;
  }
  return { ...CHART_ANIMATION_DEFAULTS, ...config };
}
