import { describe, expect, it } from 'vitest';
import { buildChartOption, pickChartKind } from '@/utils/semanticAutoChart';

describe('pickChartKind', () => {
  it('uses stat for a single metric with no dimensions', () => {
    expect(pickChartKind(['total_revenue'], [], false)).toBe('stat');
  });
  it('uses line when a time grain is active', () => {
    expect(pickChartKind(['total_revenue'], ['order_date'], true)).toBe('line');
  });
  it('uses bar for categorical dimensions', () => {
    expect(pickChartKind(['total_revenue'], ['country'], false)).toBe('bar');
  });
  it('uses bar for multiple metrics with no dimensions', () => {
    expect(pickChartKind(['a', 'b'], [], false)).toBe('bar');
  });
});

describe('buildChartOption', () => {
  const rows = [
    { country: 'KH', total_revenue: 10 },
    { country: 'TH', total_revenue: 20 },
  ];
  it('maps first dimension to xAxis and metrics to series', () => {
    const opt = buildChartOption(rows, ['total_revenue'], ['country'], 'bar');
    expect((opt.xAxis as { data: string[] }).data).toEqual(['KH', 'TH']);
    const series = opt.series as Array<{ name: string; data: number[]; type: string }>;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ name: 'total_revenue', type: 'bar', data: [10, 20] });
  });
  it('handles multiple metrics as multiple series', () => {
    const multi = [
      { country: 'KH', a: 1, b: 2 },
      { country: 'TH', a: 3, b: 4 },
    ];
    const opt = buildChartOption(multi, ['a', 'b'], ['country'], 'line');
    expect((opt.series as unknown[]).length).toBe(2);
  });
  it('renders no-dimension multi-metric rows as metric comparison categories', () => {
    const opt = buildChartOption([{ a: 1, b: 2 }], ['a', 'b'], [], 'bar');
    expect((opt.xAxis as { data: string[] }).data).toEqual(['a', 'b']);
    const series = opt.series as Array<{ data: number[] }>;
    expect(series[0].data).toEqual([1, 2]);
  });
  it('supports pie charts for a dimension and one metric', () => {
    const opt = buildChartOption(rows, ['total_revenue'], ['country'], 'pie');
    const series = opt.series as Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    expect(series[0].type).toBe('pie');
    expect(series[0].data).toEqual([
      { name: 'KH', value: 10 },
      { name: 'TH', value: 20 },
    ]);
  });
});
