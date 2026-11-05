/**
 * Whether a chart runs its own SQL or its fields — the same rule as the server
 * (server/src/modules/charts/services/v2/chart_service.py: has_structured_mapping / runs_own_sql).
 * A chart with real fields runs them (so dashboard filters apply) even when SQL is stored beside them;
 * the editor must show what runs, so the SQL box is for charts that actually run SQL.
 */

const AGGREGATE_WORDS = new Set(['count', 'sum', 'avg', 'mean', 'min', 'max', 'none', 'distinct_count', 'count_distinct']);

type Query = Record<string, unknown> | null | undefined;

export function hasStructuredMapping(chartType: string | null | undefined, query: Query): boolean {
  const q = query || {};
  if (!q.tableName) return false;
  const yMetric = q.yMetric;
  if (
    q.x ||
    q.xField ||
    (Array.isArray(q.yMetrics) && q.yMetrics.length > 0) ||
    (Array.isArray(q.xMetrics) && q.xMetrics.length > 0) ||
    (typeof yMetric === 'string' && yMetric && !AGGREGATE_WORDS.has(yMetric.toLowerCase()))
  ) {
    return true;
  }
  return ['stat', 'gauge', 'kpi'].includes(String(chartType || '').toLowerCase()) && Boolean(q.aggregate || yMetric);
}

export function runsOwnSql(widget: {
  chartType?: string | null;
  chartQuery?: Query;
  chartOptions?: Record<string, unknown> | null;
}): boolean {
  const q = widget.chartQuery || {};
  if (q.query_snapshot_id || q.snapshot_id || q.saved_query_id) return true;
  if (hasStructuredMapping(widget.chartType, q)) return false;
  const sql = widget.chartOptions?.sample_sql;
  return Boolean(String(q.compiled_semantic_sql || '').trim() || (typeof sql === 'string' && sql.trim()));
}
