import type { DashboardFilter } from '@/types/dashboard';
import type { RuntimeFilter, WidgetInstance } from '../stores/useDashboardStore';
import { resolveRuntimeFiltersForWidget } from './filterOperators';

/**
 * Widget IDs whose data may change when runtime filters change.
 */
export function getAffectedWidgetIds(
  widgets: WidgetInstance[],
  runtimeFilters: RuntimeFilter[],
  filterConfigs: DashboardFilter[],
  changedFields?: string[]
): string[] {
  const fields = changedFields?.length
    ? new Set(changedFields)
    : new Set(runtimeFilters.map((f) => f.field));

  return widgets
    .filter((w) => {
      if (w.chartType === 'slicer' || w.chartType === 'filter' || w.chartType === 'text' || !w.chartId || !w.dataSourceId) {
        return false;
      }
      const scoped = resolveRuntimeFiltersForWidget(runtimeFilters, filterConfigs, w);
      if (!scoped.length && !fields.size) return false;
      if (!changedFields?.length) return true;
      return scoped.some((f) => fields.has(f.field));
    })
    .map((w) => w.id);
}
