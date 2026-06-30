import { describe, expect, it } from 'vitest';
import { buildSeriesForType } from '../ChartSeriesBuilder';
import { DEFAULT_CHART_CONFIG } from '../WidgetRendererConfig';

describe('buildBarSeries – secondarySeries fallback', () => {
  const colors = ['#00c2cb'];
  const config = { ...DEFAULT_CHART_CONFIG };

  it('renders data when series is empty but secondarySeries has data', () => {
    const data = {
      x: ['A', 'B'],
      y: [],
      series: [],
      secondarySeries: [{ name: 'Profit', data: [100, 200] }],
    };
    const result = buildSeriesForType('bar', data as any, config, colors);
    const arr = Array.isArray(result) ? result : [result];
    // At least one series with data
    expect(arr.some((s) => Array.isArray(s.data) && s.data.length > 0)).toBe(true);
  });

  it('does not apply fallback when series already has data', () => {
    const data = {
      x: ['A', 'B'],
      y: [10, 20],
      series: [{ name: 'Revenue', data: [10, 20] }],
      secondarySeries: [{ name: 'Old', data: [5, 5] }],
    };
    const result = buildSeriesForType('bar', data as any, config, colors);
    const arr = Array.isArray(result) ? result : [result];
    // Primary series should render Revenue
    expect(arr[0].name).toBe('Revenue');
  });
});
