/** Heuristic chart type recommendations based on field types (aligned with chat pivot core). */
export type ColumnHint = { name: string; type?: string };

const DATE_TYPES = /date|time|timestamp|datetime/i;
const NUMERIC_TYPES = /int|float|double|decimal|number|numeric|real|money/i;

export type RecommendedChartType =
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'table'
  | 'stat';

export function inferColumnKind(col?: ColumnHint): 'date' | 'numeric' | 'category' {
  const t = (col?.type || '').toLowerCase();
  const n = (col?.name || '').toLowerCase();
  if (DATE_TYPES.test(t) || DATE_TYPES.test(n)) return 'date';
  if (NUMERIC_TYPES.test(t)) return 'numeric';
  return 'category';
}

export function recommendChartTypes(
  xField?: string,
  yFields: string[] = [],
  columns: ColumnHint[] = [],
): RecommendedChartType[] {
  const xCol = columns.find((c) => c.name === xField);
  const xKind = inferColumnKind(xCol);
  const yKinds = yFields.map((f) => inferColumnKind(columns.find((c) => c.name === f)));

  if (!xField && yFields.length === 0) return ['bar', 'table'];
  if (!xField && yFields.length === 1) return ['stat', 'bar', 'table'];
  if (xKind === 'date') return ['line', 'area', 'bar'];
  if (yKinds.filter((k) => k === 'numeric').length >= 2) return ['scatter', 'line', 'bar'];
  if (xKind === 'category' && yFields.length <= 1) return ['bar', 'pie', 'donut', 'table'];
  return ['bar', 'line', 'table'];
}

export function suggestDefaultFields(columns: ColumnHint[]): {
  tableName?: string;
  x?: string;
  yMetrics?: { field: string; aggregation: string }[];
} {
  if (!columns.length) return {};
  const dateCol = columns.find((c) => inferColumnKind(c) === 'date');
  const numCol = columns.find((c) => inferColumnKind(c) === 'numeric');
  const catCol = columns.find((c) => inferColumnKind(c) === 'category');
  const x = dateCol?.name || catCol?.name || columns[0]?.name;
  const yField = numCol?.name || x;
  return {
    x,
    yMetrics: yField ? [{ field: yField, aggregation: numCol ? 'sum' : 'count' }] : [],
  };
}
