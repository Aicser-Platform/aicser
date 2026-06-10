import { describe, expect, it } from 'vitest';
import { transformEchartsChartType } from './transformEchartsChartType';

describe('transformEchartsChartType', () => {
  const barConfig = {
    xAxis: { type: 'category', data: ['A', 'B'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [10, 20] }],
  };

  it('switches bar to line', () => {
    const { viewType, config } = transformEchartsChartType(barConfig, 'line');
    expect(viewType).toBe('line');
    expect((config.series as Array<{ type: string }>)[0].type).toBe('line');
  });

  it('switches to table view marker', () => {
    const result = transformEchartsChartType(barConfig, 'table');
    expect(result.viewType).toBe('table');
    expect(result.config).toBeNull();
  });

  it('builds pie from category series', () => {
    const { viewType, config } = transformEchartsChartType(barConfig, 'pie');
    expect(viewType).toBe('pie');
    const series = (config.series as Array<{ type: string; data: unknown[] }>)[0];
    expect(series.type).toBe('pie');
    expect(series.data).toHaveLength(2);
  });
});
