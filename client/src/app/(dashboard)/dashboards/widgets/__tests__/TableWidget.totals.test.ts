import { describe, expect, it } from 'vitest';
import { isAdditiveColumn } from '../TableWidget';

describe('table Total row', () => {
  it('sums additive measures', () => {
    expect(isAdditiveColumn('principal_amount', { yMetrics: [{ field: 'principal_amount', aggregation: 'sum' }] })).toBe(true);
    expect(isAdditiveColumn('order_count')).toBe(true);
  });

  it('never adds up averages, minimums or maximums', () => {
    expect(isAdditiveColumn('interest_rate', { yMetrics: [{ field: 'interest_rate', aggregation: 'avg' }] })).toBe(false);
    expect(isAdditiveColumn('avg_interest_rate')).toBe(false);
    expect(isAdditiveColumn('Max Balance')).toBe(false);
  });
});
