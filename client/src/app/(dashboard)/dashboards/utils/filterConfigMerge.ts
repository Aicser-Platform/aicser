import type { DashboardFilter } from '@/types/dashboard';
import { buildDefaultRuntimeFilters, type RuntimeFilter } from './filterOperators';

/** Merge global + page filter configs; page wins on duplicate field names. */
export function mergeFilterConfigs(
  global: DashboardFilter[],
  page: DashboardFilter[],
  options?: { markPageAsNonGlobal?: boolean },
): DashboardFilter[] {
  const byField = new Map<string, DashboardFilter>();
  global.forEach((f) => {
    if (f.field) byField.set(f.field, f);
  });
  page.forEach((f) => {
    if (f.field) {
      byField.set(
        f.field,
        options?.markPageAsNonGlobal ? { ...f, isGlobal: false } : f,
      );
    }
  });
  return Array.from(byField.values());
}

/** Build default runtime filter values from one or more config layers (later wins). */
export function mergeFilterDefaults(...configs: DashboardFilter[][]): RuntimeFilter[] {
  const byField = new Map<string, DashboardFilter>();
  configs.flat().forEach((f) => {
    if (f.field) byField.set(f.field, f);
  });
  return buildDefaultRuntimeFilters(Array.from(byField.values()));
}

/** Chart types supported by dashboard WidgetRenderer (excludes table/stat/text/slicer). */
export const DASHBOARD_CHART_TYPES = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'funnel',
  'heatmap',
] as const;

export type DashboardChartType = (typeof DASHBOARD_CHART_TYPES)[number];

export function isDashboardChartType(type: string): type is DashboardChartType {
  return (DASHBOARD_CHART_TYPES as readonly string[]).includes(type);
}

export function normalizeDashboardChartType(type: string): DashboardChartType {
  return isDashboardChartType(type) ? type : 'bar';
}
