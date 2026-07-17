import { CHART_TYPE_CONFIGS } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

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
] as const;

export type InteractiveChartType = (typeof INTERACTIVE_CHART_TYPES)[number];

export function chartTypeLabel(type: string): string {
  if (type === 'table') return 'Table';
  if (type === 'bar_race') return 'Bar race';
  if (type === 'line_race') return 'Line race';
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

/** Which chart types make sense for the query result shape (same rules as chat menu). */
export function listAvailableChartTypes(
  rows: Array<Record<string, unknown>> | null | undefined,
): InteractiveChartType[] {
  const base: InteractiveChartType[] = ['bar', 'line', 'area', 'table'];
  if (!rows?.length) return base;

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
  return types;
}

export function chartTypeSelectOptions(types: readonly string[]): { label: string; value: string }[] {
  return types.map((value) => ({ label: chartTypeLabel(value), value }));
}
