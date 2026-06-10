import type { WidgetInstance } from '../stores/useDashboardStore';

/** Build a minimal monitoring SQL from widget chartQuery when no saved SQL exists. */
export function buildWidgetAlertSql(widget: WidgetInstance): string | null {
  const q = widget.chartQuery;
  if (!q?.tableName || !q?.yMetrics?.[0]?.field) return null;

  const metric = q.yMetrics[0];
  const field = metric.field;
  const agg = metric.aggregation || 'sum';
  const expr =
    agg === 'none'
      ? field
      : agg === 'count'
        ? `COUNT(${field})`
        : agg === 'distinct_count'
          ? `COUNT(DISTINCT ${field})`
          : `${agg.toUpperCase()}(${field})`;

  return `SELECT ${expr} AS value FROM ${q.tableName} LIMIT 1`;
}
