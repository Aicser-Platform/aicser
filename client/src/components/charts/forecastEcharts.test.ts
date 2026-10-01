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

  it('shows the 80% and 95% ranges and hides both band helpers', () => {
    const html = forecastTooltipHtml([
      {
        seriesName: 'Forecast',
        marker: 'o',
        data: { value: 130, lower: 100, upper: 170, lower_80: 115, upper_80: 150 },
        axisValue: '2025-02-01',
      },
      { seriesName: '_ci80_lower', marker: '', value: 115, axisValue: '2025-02-01' },
      { seriesName: '80% interval', marker: '', value: 35, axisValue: '2025-02-01' },
    ]);
    expect(html).toContain('80% interval: 115 – 150');
    expect(html).toContain('95% interval: 100 – 170');
    expect(html).not.toContain('_ci80_lower');
    expect(html.match(/80% interval/g)?.length).toBe(1);
  });

  it('labels the in-progress point with its completeness', () => {
    const html = forecastTooltipHtml([
      { seriesName: 'In progress', marker: 'o', data: { value: 1295, coverage_pct: 30 }, axisValue: '2025-06-01' },
    ]);
    expect(html).toContain('In progress (30% complete)');
    expect(html).toContain('1,295');
  });

  it('keeps the inner band on its own stack and lists it in the legend', () => {
    const polished = polishForecastEchartsOption({
      ...forecastCfg,
      legend: { data: [] },
      series: [
        ...forecastCfg.series,
        { name: '_ci_lower', type: 'line', stack: 'ci', data: [] },
        { name: '95% interval', type: 'line', stack: 'ci', data: [] },
        { name: '_ci80_lower', type: 'line', stack: 'ci80', data: [] },
        { name: '80% interval', type: 'line', stack: 'ci80', data: [] },
        { name: 'In progress', type: 'scatter', data: [] },
      ],
    });
    const series = polished.series as Array<{ name: string; stack?: string }>;
    expect(series.find((x) => x.name === '80% interval')?.stack).toBe('ci80');
    expect(series.find((x) => x.name === '_ci80_lower')?.stack).toBe('ci80');
    expect(series.find((x) => x.name === '95% interval')?.stack).toBe('ci');
    const legend = (polished.legend as { data: Array<string | { name: string }> }).data.map((d) =>
      typeof d === 'string' ? d : d.name,
    );
    expect(legend).toEqual(['Historical', 'Forecast', '80% interval', '95% interval', 'In progress']);
  });

  it('formats hourly axis labels with the time', () => {
    expect(formatForecastAxisDate('2025-03-04 14:00', false)).toBe('4 Mar 14:00');
  });
});
