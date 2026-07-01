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
      if (scoped.some((f) => fields.has(f.field))) return true;

      const widgetKeys = new Set([w.id, w.chartId].filter(Boolean) as string[]);
      const removedOrClearedConfig = filterConfigs.some((filter) => {
        if (!fields.has(filter.field)) return false;
        const scope = filter.affects;
        if (!scope?.length) return true;
        return scope.some((id) => widgetKeys.has(id));
      });
      return removedOrClearedConfig;
    })
    .map((w) => w.id);
}
