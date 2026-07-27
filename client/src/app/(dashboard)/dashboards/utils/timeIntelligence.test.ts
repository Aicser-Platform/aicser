import { describe, expect, it } from 'vitest';
import {
  shiftDateRangeForComparison,
  shiftFiltersForComparison,
  rangeMtd,
  COMPARISON_PERIOD_LABELS,
} from './timeIntelligence';

describe('timeIntelligence', () => {
  it('shifts wow by 7 days', () => {
    const r = shiftDateRangeForComparison('2024-03-08', '2024-03-14', 'wow');
    expect(r).toEqual({ from: '2024-03-01', to: '2024-03-07' });
  });

  it('shifts mom by one month', () => {
    const r = shiftDateRangeForComparison('2024-03-01', '2024-03-15', 'mom');
    expect(r.from).toBe('2024-02-01');
    expect(r.to).toBe('2024-02-15');
  });

  it('shifts date filters for mom', () => {
    const shifted = shiftFiltersForComparison(
      [
        { field: 'order_date', operator: '>=', value: '2024-03-01' },
        { field: 'order_date', operator: '<=', value: '2024-03-31' },
      ],
      'mom',
    );
    expect(shifted).toEqual([
      { field: 'order_date', operator: '>=', value: '2024-02-01' },
      { field: 'order_date', operator: '<=', value: '2024-02-29' },
    ]);
  });

  it('returns null when no date bounds', () => {
    expect(shiftFiltersForComparison([{ field: 'region', operator: '=', value: 'West' }], 'yoy')).toBeNull();
  });

  it('mtd ends at today', () => {
    const r = rangeMtd();
    expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COMPARISON_PERIOD_LABELS.yoy).toContain('year');
  });
});
