import type { DashboardFilter } from '@/types/dashboard';
import { buildDefaultRuntimeFilters, type RuntimeFilter } from './filterOperators';
import {
  DASHBOARD_SWITCHABLE_CHART_TYPES,
  isDashboardSwitchableChartType,
  type DashboardSwitchableChartType,
} from '@/components/charts/chartTypeCatalog';

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

/** Chart types supported by dashboard WidgetRenderer (alias of switchable catalog). */
export const DASHBOARD_CHART_TYPES = DASHBOARD_SWITCHABLE_CHART_TYPES;
export type DashboardChartType = DashboardSwitchableChartType;
export const isDashboardChartType = isDashboardSwitchableChartType;

export function normalizeDashboardChartType(type: string): DashboardChartType {
  return isDashboardSwitchableChartType(type) ? type : 'bar';
}
