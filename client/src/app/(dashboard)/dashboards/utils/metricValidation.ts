/**
 * Aggregation ↔ column-type validation for Build metrics (analyst trust).
 */

export type ColumnTypeInfo = { value: string; type?: string; label?: string };

export type MetricValidationIssue = {
  field: string;
  aggregation: string;
  severity: 'warning' | 'error';
  message: string;
};

const SUM_LIKE = new Set(['sum', 'avg', 'mean', 'min', 'max']);

export function isNumericColumnType(type?: string): boolean {
  const t = (type || '').toLowerCase();
  return (
    t.includes('int') ||
    t.includes('float') ||
    t.includes('number') ||
    t.includes('decimal') ||
    t.includes('double') ||
    t.includes('real') ||
    t.includes('numeric') ||
    t.includes('money')
  );
}

/** True when field name looks like an identifier (summing IDs is usually wrong). */
export function looksLikeIdentifierField(field?: string): boolean {
  if (!field) return false;
  const f = field.toLowerCase();
  return (
    f === 'id' ||
    f.endsWith('_id') ||
    (f.endsWith('id') && f.length <= 12) ||
    f.includes('uuid') ||
    f.includes('guid')
  );
}

export function validateMetricAggregation(
  field: string,
  aggregation: string,
  columnType?: string,
): MetricValidationIssue | null {
  const agg = (aggregation || '').toLowerCase();
  if (!field || !agg || agg === 'none' || agg === 'count' || agg === 'distinct_count') {
    return null;
  }

  if (SUM_LIKE.has(agg) && !isNumericColumnType(columnType) && columnType && columnType !== 'unknown') {
    return {
      field,
      aggregation: agg,
      severity: 'error',
      message: `${agg} requires a numeric column; “${field}” looks like ${columnType || 'text'}. Use Count instead.`,
    };
  }

  if (SUM_LIKE.has(agg) && looksLikeIdentifierField(field)) {
    return {
      field,
      aggregation: agg,
      severity: 'warning',
      message: `${agg} of “${field}” is usually not meaningful (identifier). Prefer Count or a measure column.`,
    };
  }

  return null;
}

export function validateYMetrics(
  metrics: Array<{ field?: string; aggregation?: string }> | undefined,
  columns: Array<{ value: string; type?: string }>,
): MetricValidationIssue[] {
  if (!metrics?.length) return [];
  const byName = new Map(columns.map((c) => [c.value, c.type]));
  const issues: MetricValidationIssue[] = [];
  for (const m of metrics) {
    if (!m?.field) continue;
    const issue = validateMetricAggregation(m.field, m.aggregation || 'count', byName.get(m.field));
    if (issue) issues.push(issue);
  }
  return issues;
}
