import { computedMetricToExpression } from '../computedMetricExpression';

describe('computedMetricToExpression', () => {
  it('builds ratio with percent multiplier', () => {
    const expr = computedMetricToExpression({
      type: 'ratio',
      numerator: { field: 'revenue', aggregation: 'sum' },
      denominator: { field: 'orders', aggregation: 'sum' },
      multiplier: 100,
    });
    expect(expr).toBe('SUM("revenue") * 1.0 / NULLIF(SUM("orders"), 0) * 100');
  });

  it('builds change expression', () => {
    const expr = computedMetricToExpression({
      type: 'change',
      numerator: { field: 'a', aggregation: 'sum' },
      denominator: { field: 'b', aggregation: 'sum' },
      multiplier: 1,
    });
    expect(expr).toBe('((SUM("a")) - (SUM("b"))) * 1.0 / NULLIF(SUM("b"), 0)');
  });
});
