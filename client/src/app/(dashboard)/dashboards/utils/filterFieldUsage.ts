import type { WidgetInstance } from '../stores/dashboardStoreTypes';

function normalizeField(field?: string): string {
  return (field || '').trim().toLowerCase();
}

/** Collect SQL/query field names referenced by a widget. */
export function collectWidgetFieldRefs(widget: WidgetInstance): string[] {
  const q = widget.chartQuery || {};
  const refs = new Set<string>();
  const add = (f?: string) => {
    const n = normalizeField(f);
    if (n) refs.add(n);
  };

  add(q.field as string | undefined);
  add(q.x as string | undefined);
  add(q.y as string | undefined);
  add(q.groupBy as string | undefined);
  add(q.tableName as string | undefined);

  if (Array.isArray(q.yMetrics)) {
    q.yMetrics.forEach((m: { field?: string }) => add(m.field));
  }
  if (Array.isArray(q.xMetrics)) {
    q.xMetrics.forEach((m: { field?: string }) => add(m.field));
  }
  if (Array.isArray(q.dimensions)) {
    q.dimensions.forEach((d: { field?: string }) => add(d.field));
  }
  if (Array.isArray(q.filters)) {
    q.filters.forEach((f: { field?: string }) => add(f.field));
  }

  return [...refs];
}

export function widgetIdsUsingField(widgets: WidgetInstance[], field: string): string[] {
  const key = normalizeField(field);
  if (!key) return [];
  return widgets
    .filter((w) => w.chartType !== 'slicer' && w.chartType !== 'text' && w.chartType !== 'divider')
    .filter((w) => collectWidgetFieldRefs(w).some((ref) => ref === key || ref.endsWith(`.${key}`)))
    .map((w) => w.id);
}

export function countWidgetsUsingField(widgets: WidgetInstance[], field: string): number {
  return widgetIdsUsingField(widgets, field).length;
}

/** Primary data source id used by most data widgets on the dashboard. */
export function inferPrimaryDataSourceId(widgets: WidgetInstance[]): string | undefined {
  const counts = new Map<string, number>();
  widgets.forEach((w) => {
    if (!w.dataSourceId || w.chartType === 'text' || w.chartType === 'divider') return;
    const id = String(w.dataSourceId);
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  let best: string | undefined;
  let bestCount = 0;
  counts.forEach((count, id) => {
    if (count > bestCount) {
      bestCount = count;
      best = id;
    }
  });
  return best;
}
