import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance } from '../stores/useDashboardStore';

export type FilterConflictSource = 'global' | 'page' | 'slicer';

export type FilterFieldConflict = {
  field: string;
  sources: FilterConflictSource[];
  slicerWidgetIds: string[];
  configuredFilterIds: string[];
};

function normalizeField(field?: string): string {
  return (field || '').trim().toLowerCase();
}

/**
 * Detect fields used by both configured (global/page) filters and canvas slicer widgets.
 * Same field in multiple places can cause confusing double-filter UX.
 */
export function detectFilterFieldConflicts(
  globalFilters: DashboardFilter[],
  pageFilters: DashboardFilter[],
  widgets: WidgetInstance[],
): FilterFieldConflict[] {
  const byField = new Map<string, FilterFieldConflict>();

  const touch = (
    field: string,
    source: FilterConflictSource,
    meta?: { filterId?: string; widgetId?: string },
  ) => {
    const key = normalizeField(field);
    if (!key) return;
    let entry = byField.get(key);
    if (!entry) {
      entry = { field, sources: [], slicerWidgetIds: [], configuredFilterIds: [] };
      byField.set(key, entry);
    }
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (meta?.filterId && !entry.configuredFilterIds.includes(meta.filterId)) {
      entry.configuredFilterIds.push(meta.filterId);
    }
    if (meta?.widgetId && !entry.slicerWidgetIds.includes(meta.widgetId)) {
      entry.slicerWidgetIds.push(meta.widgetId);
    }
  };

  for (const f of globalFilters) {
    if (f.field) touch(f.field, 'global', { filterId: f.id });
  }
  for (const f of pageFilters) {
    if (f.field) touch(f.field, 'page', { filterId: f.id });
  }
  for (const w of widgets) {
    if (w.chartType !== 'slicer' && w.chartType !== 'filter') continue;
    const field = w.chartQuery?.field || w.chartQuery?.x;
    if (field) touch(String(field), 'slicer', { widgetId: w.id });
  }

  return [...byField.values()].filter(
    (c) => c.sources.includes('slicer') && c.sources.some((s) => s === 'global' || s === 'page'),
  );
}

export function isSlicerFieldConflicted(
  field: string | undefined,
  conflicts: FilterFieldConflict[],
): FilterFieldConflict | undefined {
  if (!field) return undefined;
  const key = normalizeField(field);
  return conflicts.find((c) => normalizeField(c.field) === key);
}
