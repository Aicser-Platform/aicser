import { describe, expect, it } from 'vitest';
import { buildChartOptions } from '../ChartOptionsBuilder';

describe('charts with a design keep their formatters', () => {
  it('formats date axis labels after the design pass', () => {
    const x = ['2024-01-01T00:00:00', '2024-01-08T00:00:00'];
    const option = buildChartOptions(
      'area',
      { x, series: [{ name: 'A', data: [1, 2] }] } as never,
      { design: { axis: { xScale: 'linear', yScale: 'linear' } } } as never,
    );
    const axis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
    expect(typeof axis.axisLabel.formatter).toBe('function');
    expect(axis.axisLabel.formatter(x[0])).not.toContain('T00:00');
  });
});
