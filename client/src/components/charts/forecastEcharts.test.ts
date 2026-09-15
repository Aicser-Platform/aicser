import { describe, expect, it } from 'vitest';
import {
  forecastAxisLooksMonthly,
  forecastTooltipHtml,
  formatForecastAxisDate,
  plotValueFromForecastPoint,
  polishForecastEchartsOption,
} from './forecastEcharts';
import { shouldPackageQueryRowsAsSharedChart } from './hydrateChartConfig';

const forecastCfg = {
  series: [
    { name: 'Historical', type: 'line', data: [100, 110, 120, null, null] },
    {
      name: 'Forecast',
      type: 'line',
      data: [null, null, { value: 120 }, { value: 130, lower: 110, upper: 160 }, { value: 140, lower: 115, upper: 170 }],
    },
  ],
  xAxis: { type: 'category', data: ['2024-11-01', '2024-12-01', '2025-01-01', '2025-02-01', '2025-03-01'] },
};

describe('shouldPackageQueryRowsAsSharedChart', () => {
  it('does not package SQL rows when Historical+Forecast series are present', () => {
    expect(shouldPackageQueryRowsAsSharedChart(forecastCfg)).toBe(false);
  });

  it('packages SQL rows when the option has no renderable series', () => {
    expect(shouldPackageQueryRowsAsSharedChart({ title: { text: 'Table' } })).toBe(true);
  });
});

describe('forecastEcharts', () => {
  it('formats monthly axis dates without UTC shift', () => {
    expect(formatForecastAxisDate('2024-11-01', true)).toBe('Nov 2024');
    expect(formatForecastAxisDate('2025-01-15', false)).toBe('15 Jan 2025');
  });

  it('treats unique year-month categories as monthly', () => {
    expect(forecastAxisLooksMonthly(forecastCfg.xAxis.data)).toBe(true);
  });

  it('reads forecast point objects and 95% interval in the tooltip', () => {
    const html = forecastTooltipHtml([
      { seriesName: 'Historical', marker: '*', value: 120, axisValue: '2025-01-01' },
      {
        seriesName: 'Forecast',
        marker: 'o',
        data: { value: 130, lower: 110, upper: 160 },
        axisValue: '2025-02-01',
      },
    ]);
    expect(html).toContain('Historical');
    expect(html).toContain('130');
    expect(html).toContain('95% interval');
    expect(html).toContain('110');
    expect(html).not.toContain('[object Object]');
  });

  it('skips CI helper series in the tooltip', () => {
    const html = forecastTooltipHtml([
      { seriesName: 'Forecast', marker: 'o', data: { value: 130, lower: 110, upper: 160 }, axisValue: '2025-02-01' },
      { seriesName: '_ci_lower', marker: '', value: 110, axisValue: '2025-02-01' },
      { seriesName: '95% interval', marker: '', value: 50, axisValue: '2025-02-01' },
    ]);
    expect(html).toContain('Forecast');
    expect(html).toContain('95% interval: 110');
    expect(html).not.toContain('_ci_lower');
    expect(html.match(/95% interval/g)?.length).toBe(1);
  });

  it('installs a function tooltip and date axis formatter', () => {
    const polished = polishForecastEchartsOption({ ...forecastCfg });
    const tooltip = polished.tooltip as { formatter?: (p: unknown) => string };
    expect(typeof tooltip.formatter).toBe('function');
    const xAxis = polished.xAxis as { axisLabel?: { formatter?: (v: string) => string } };
    expect(xAxis.axisLabel?.formatter?.('2024-11-01')).toBe('Nov 2024');
  });
});
