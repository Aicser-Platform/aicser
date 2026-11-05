import { describe, expect, it } from 'vitest';
import { inferChartMapping } from '../queryBindBridge';

const columns = [
  { name: 'branch_province', type: 'string' },
  { name: 'loans', type: 'integer' },
  { name: 'total_loan_usd', type: 'number' },
  { name: 'avg_credit_score', type: 'number' },
];
const rows = [
  { branch_province: 'Phnom Penh', loans: 1846, total_loan_usd: 17727350, avg_credit_score: 626.5 },
  { branch_province: 'Siem Reap', loans: 498, total_loan_usd: 3851400, avg_credit_score: 627.8 },
];

describe('inferChartMapping', () => {
  it('puts only measures of a similar scale on one axis', () => {
    const mapping = inferChartMapping(columns, 'bar', { sampleRows: rows, preferNoneAggregation: true });
    expect(mapping.x).toBe('branch_province');
    expect(mapping.yMetrics.map((m) => m.field)).toEqual(['total_loan_usd']);
  });

  it('keeps every measure when there are no rows to compare', () => {
    const mapping = inferChartMapping(columns, 'bar', { preferNoneAggregation: true });
    expect(mapping.yMetrics).toHaveLength(3);
  });
});
