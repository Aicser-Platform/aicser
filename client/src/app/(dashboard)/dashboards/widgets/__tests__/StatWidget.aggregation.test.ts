import { describe, expect, it } from 'vitest';
import { resolveSeriesAggregation } from '../StatWidget';

describe('resolveSeriesAggregation', () => {
  it('uses the real query aggregation, not the free-text title', () => {
    // "Average Order Value" but the underlying query actually sums — must sum, not re-average.
    const query = { yMetrics: [{ field: 'order_value', aggregation: 'sum' }] };
    expect(resolveSeriesAggregation(query, 'average order value')).toBe('sum');
  });

  it('maps count/distinct_count aggregations to sum (full-window total)', () => {
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'id', aggregation: 'count' }] }, '')).toBe('sum');
    expect(
      resolveSeriesAggregation({ yMetrics: [{ field: 'id', aggregation: 'distinct_count' }] }, ''),
    ).toBe('sum');
  });

  it('maps avg/average/mean aggregations to avg', () => {
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'x', aggregation: 'avg' }] }, '')).toBe('avg');
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'x', aggregation: 'mean' }] }, '')).toBe('avg');
  });

  it('maps none/max/min aggregations to latest-point', () => {
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'x', aggregation: 'none' }] }, '')).toBe('latest');
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'x', aggregation: 'max' }] }, '')).toBe('latest');
    expect(resolveSeriesAggregation({ yMetrics: [{ field: 'x', aggregation: 'min' }] }, '')).toBe('latest');
  });

  it('falls back to title-text heuristic when no query aggregation is available', () => {
    expect(resolveSeriesAggregation(undefined, 'total revenue')).toBe('sum');
    expect(resolveSeriesAggregation(undefined, 'record count')).toBe('sum');
    expect(resolveSeriesAggregation(undefined, 'average order value')).toBe('avg');
    expect(resolveSeriesAggregation(undefined, 'monthly revenue')).toBe('latest');
  });

  it('honors singular yMetric when yMetrics array is absent', () => {
    expect(resolveSeriesAggregation({ yMetric: 'sum' }, '')).toBe('sum');
  });
});
