import { CHART_TYPE_CONFIGS } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

/**
 * Shared chart-type catalogs for chat pivot + dashboard Build switcher.
 *
 * Chat instant-transform supports the interactive set (shape-filtered).
 * Dashboard Build uses the same core order, then extended visuals.
 */

/** Core visuals shared with /chat pivot (same order as listAvailableChartTypes base). */
export const SHARED_CHART_TYPE_ORDER = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'table',
  'stat',
] as const;

/** Dashboard-only visuals (Build switcher; not in chat client-side transform yet). */
export const DASHBOARD_EXTENDED_CHART_TYPES = [
  'heatmap',
  'funnel',
  'gauge',
  'treemap',
  'waterfall',
  'bullet',
  'geo',
] as const;

/** Full Build → chart type switcher list (chat core first, then dashboard extensions). */
export const DASHBOARD_SWITCHABLE_CHART_TYPES = [
  ...SHARED_CHART_TYPE_ORDER,
  ...DASHBOARD_EXTENDED_CHART_TYPES,
] as const;

export type DashboardSwitchableChartType = (typeof DASHBOARD_SWITCHABLE_CHART_TYPES)[number];

/** Chart types available for instant client-side transform in chat / preview. */
export const INTERACTIVE_CHART_TYPES = [
  'bar',
  'line',
  'area',
  'bar_race',
  'line_race',
  'pie',
  'donut',
  'scatter',
  'table',
  'stat',
] as const;

export type InteractiveChartType = (typeof INTERACTIVE_CHART_TYPES)[number];

/** Short labels for icon switchers (Build / chips). */
const SHORT_LABELS: Record<string, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  table: 'Table',
  stat: 'KPI',
  heatmap: 'Heatmap',
  funnel: 'Funnel',
  gauge: 'Gauge',
  treemap: 'Treemap',
  waterfall: 'Waterfall',
  bullet: 'Bullet',
  geo: 'Geo',
  bar_race: 'Bar race',
  line_race: 'Line race',
};

export function chartTypeShortLabel(type: string): string {
  return SHORT_LABELS[type] ?? chartTypeLabel(type);
}

export function chartTypeLabel(type: string): string {
  if (type === 'table') return 'Table';
  if (type === 'bar_race') return 'Bar race';
  if (type === 'line_race') return 'Line race';
  if (type === 'stat') return CHART_TYPE_CONFIGS.stat?.label ?? 'KPI Card';
  return CHART_TYPE_CONFIGS[type]?.label ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function inferSeriesChartType(
  config: unknown,
  override: string | null | undefined,
): string {
  if (override) return override.toLowerCase();
  if (!config || typeof config !== 'object') return 'bar';
  const series = (config as { series?: Array<{ type?: string }> }).series;
  const t = Array.isArray(series) && series[0]?.type ? String(series[0].type).toLowerCase() : 'bar';
  if (t === 'line' && Array.isArray(series) && series.some((s) => s && 'areaStyle' in s && s.areaStyle)) {
    return 'area';
  }
  return t;
}

/**
 * Which chart types make sense for the query result shape (same rules as chat menu).
 * Order matches SHARED_CHART_TYPE_ORDER subset so chat pivot and Build feel aligned.
 */
export function listAvailableChartTypes(
  rows: Array<Record<string, unknown>> | null | undefined,
): InteractiveChartType[] {
  if (!rows?.length) return ['bar', 'line', 'area', 'table'];

  const first = rows[0] ?? {};
  const cols = Object.keys(first);
  const numCols = cols.filter((k) => typeof first[k] === 'number').length;
  const strCols = cols.filter((k) => typeof first[k] === 'string').length;

  const types: InteractiveChartType[] = ['bar', 'line', 'area'];
  if (numCols >= 1 && strCols >= 1) {
    types.push('pie', 'donut');
  }
  if (numCols >= 2) {
    types.push('scatter');
  }
  types.push('table');
  if (rows.length === 1 && numCols >= 1) {
    types.push('stat');
  }
  return types;
}

export function chartTypeSelectOptions(types: readonly string[]): { label: string; value: string }[] {
  return types.map((value) => ({ label: chartTypeLabel(value), value }));
}

export function isInteractiveChartType(type: string): type is InteractiveChartType {
  return (INTERACTIVE_CHART_TYPES as readonly string[]).includes(type);
}

export function isDashboardSwitchableChartType(type: string): type is DashboardSwitchableChartType {
  return (DASHBOARD_SWITCHABLE_CHART_TYPES as readonly string[]).includes(type);
}

/**
 * Chart types for Query Visualize / designer pin — chat shape filter for the shared core,
 * then all dashboard-extended visuals (heatmap…geo) so pin targets match Build switcher.
 */
export function listDashboardVisualizeChartTypes(
  rows: Array<Record<string, unknown>> | null | undefined,
): string[] {
  const core = listAvailableChartTypes(rows);
  const out: string[] = [...core];
  for (const type of DASHBOARD_EXTENDED_CHART_TYPES) {
    if (!out.includes(type)) out.push(type);
  }
  return out;
}
