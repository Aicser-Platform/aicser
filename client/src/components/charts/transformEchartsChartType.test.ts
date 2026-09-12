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
    expect((config!.series as Array<{ type: string }>)[0].type).toBe('line');
  });

  it('switches to table view marker', () => {
    const result = transformEchartsChartType(barConfig, 'table');
    expect(result.viewType).toBe('table');
    expect(result.config).toBeNull();
  });

  it('builds pie from category series', () => {
    const { viewType, config } = transformEchartsChartType(barConfig, 'pie');
    expect(viewType).toBe('pie');
    const series = (config!.series as Array<{ type: string; data: unknown[] }>)[0];
    expect(series.type).toBe('pie');
    expect(series.data).toHaveLength(2);
  });

  it('keeps stacked 95% interval band when switching forecast to line', () => {
    const forecastConfig = {
      xAxis: { type: 'category', data: ['A', 'B', 'C'] },
      yAxis: { type: 'value' },
      series: [
        { name: 'Historical', type: 'line', data: [10, 11, null] },
        { name: 'Forecast', type: 'line', data: [null, 11, 12] },
        {
          name: '_ci_lower',
          type: 'line',
          stack: 'ci',
          data: [null, 10, 11],
          areaStyle: { opacity: 0 },
        },
        {
          name: '95% interval',
          type: 'line',
          stack: 'ci',
          data: [null, 2, 3],
          areaStyle: { color: 'rgba(145, 204, 117, 0.35)' },
        },
      ],
    };
    const { config } = transformEchartsChartType(forecastConfig, 'line');
    const series = (config!.series as Array<Record<string, unknown>>) || [];
    const names = series.map((s) => s.name);
    expect(names).toEqual(['Historical', 'Forecast', '_ci_lower', '95% interval']);
    const band = series.find((s) => s.name === '95% interval')!;
    expect(band.stack).toBe('ci');
    expect(band.areaStyle).toBeTruthy();
  });

  it('drops legacy Lower Bound helpers when switching to area', () => {
    const forecastConfig = {
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [
        { name: 'Historical', type: 'line', data: [10, null] },
        { name: 'Forecast', type: 'line', data: [null, 20] },
        { name: 'Lower Bound', type: 'line', stack: 'confidence-band', data: [0, 5] },
        { name: '95% Confidence', type: 'line', areaStyle: { opacity: 0.3 }, data: [0, 3] },
      ],
    };
    const { config } = transformEchartsChartType(forecastConfig, 'area');
    const names = ((config!.series as Array<{ name: string }>) || []).map((s) => s.name);
    expect(names).toEqual(['Historical', 'Forecast']);
  });
});
