import { describe, expect, it } from 'vitest';
import { hasStructuredMapping, runsOwnSql } from './chartQueryMode';

describe('chart query mode (same rule as the server)', () => {
  it('a KPI with a table and a count runs its fields, not SQL stored beside it', () => {
    const overdue = {
      chartType: 'stat',
      chartQuery: { aggregate: 'count', tableName: 'loans' },
      chartOptions: { sample_sql: 'SELECT COUNT(*) AS value FROM banking.loans WHERE npl_flag = true' },
    };
    expect(hasStructuredMapping(overdue.chartType, overdue.chartQuery)).toBe(true);
    expect(runsOwnSql(overdue)).toBe(false);
  });

  it('a chart with only SQL (or a saved query) runs that SQL', () => {
    expect(runsOwnSql({ chartType: 'bar', chartQuery: {}, chartOptions: { sample_sql: 'SELECT 1' } })).toBe(true);
    expect(runsOwnSql({ chartType: 'bar', chartQuery: { tableName: 'loans', saved_query_id: 'q1', x: 'a' } })).toBe(true);
  });

  it('a default "count" stamped on a bar chart without fields is not a mapping', () => {
    expect(hasStructuredMapping('bar', { tableName: 'loans', aggregate: 'count', yMetric: 'count' })).toBe(false);
  });
});
