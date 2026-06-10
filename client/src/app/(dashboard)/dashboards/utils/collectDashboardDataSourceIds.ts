import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance } from '../stores/useDashboardStore';

/** Unique data source IDs referenced by widgets and filter configs on a dashboard page. */
export function collectDashboardDataSourceIds(
  widgets: WidgetInstance[],
  filters: DashboardFilter[] = [],
): string[] {
  const ids = new Set<string>();
  for (const w of widgets) {
    if (w.dataSourceId) ids.add(String(w.dataSourceId));
  }
  for (const f of filters) {
    if (f.dataSourceId) ids.add(String(f.dataSourceId));
  }
  return [...ids];
}
