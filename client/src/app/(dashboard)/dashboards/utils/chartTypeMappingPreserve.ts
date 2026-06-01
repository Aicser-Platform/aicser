import type { WidgetInstance } from '../stores/dashboardStoreTypes';

/** Chart types that share the same x/y metric mapping shape. */
const COMPATIBLE_GROUPS: string[][] = [
  ['bar', 'line', 'area'],
  ['pie', 'donut'],
  ['scatter'],
  ['stat', 'gauge'],
  ['table'],
];

function compatibleGroup(chartType: string): string[] | null {
  return COMPATIBLE_GROUPS.find((g) => g.includes(chartType)) || null;
}

/**
 * When changing chart type, preserve chartQuery fields when types are compatible.
 */
export function preserveChartQueryOnTypeChange(
  widget: WidgetInstance,
  nextType: string,
): Record<string, unknown> {
  const prevType = widget.chartType;
  if (prevType === nextType) return { ...(widget.chartQuery || {}) };

  const prevGroup = compatibleGroup(prevType);
  const nextGroup = compatibleGroup(nextType);
  if (prevGroup && nextGroup && prevGroup === nextGroup) {
    return { ...(widget.chartQuery || {}) };
  }

  // pie/donut from bar family — keep x, drop y series shape if incompatible
  if ((nextType === 'pie' || nextType === 'donut') && ['bar', 'line', 'area'].includes(prevType)) {
    const q = { ...(widget.chartQuery || {}) };
    if (q.x && !q.groupBy) q.groupBy = q.x;
    return q;
  }

  return { ...(widget.chartQuery || {}) };
}
