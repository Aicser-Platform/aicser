import { describe, expect, it } from 'vitest';
import { buildPieSeries } from '../ChartSeriesBuilder';
import { crossFilterValueFromClick } from '../../utils/crossFilterChart';

describe('pie slice names', () => {
  const data = {
    x: ['2024-06-01T00:00:00', '2024-07-01T00:00:00'],
    y: [10, 20],
    series: [{ name: 'Total', data: [10, 20] }],
  } as any;

  it('reads dates like an axis, and a click filters by the raw value', () => {
    const series = buildPieSeries(data, {} as any) as any;
    const item = (Array.isArray(series) ? series[0] : series).data[0];
    expect(item.name).toBe('Jun 2024');
    expect(item.raw).toBe('2024-06-01T00:00:00');
    expect(crossFilterValueFromClick({ componentType: 'series', name: item.name, data: item }, 'pie')).toBe(
      '2024-06-01T00:00:00',
    );
  });
});
