import { describe, expect, it } from 'vitest';
import { buildSeriesForType } from '../ChartSeriesBuilder';
import { DEFAULT_CHART_CONFIG } from '../WidgetRendererConfig';

describe('buildBarSeries — conditional formatting (consolidated rule engine)', () => {
  it('colors only the bars that breach the rule, leaving the rest as plain values', () => {
    const data = {
      x: ['Jan', 'Feb', 'Mar', 'Apr'],
      y: [50, 150, 90, 200],
      series: [{ name: 'revenue', data: [50, 150, 90, 200] }],
    };
    const config = {
      ...DEFAULT_CHART_CONFIG,
      conditionalFormatting: [
        { id: 'r1', column: 'revenue', operator: 'gt' as const, value: '100', bgColor: '#ff4d4f', applyTo: 'cell' as const },
      ],
    };
    const result = buildSeriesForType('bar', data as any, config, ['#00c2cb']);
    const arr = Array.isArray(result) ? result : [result];
    const revenueSeries = arr.find((s) => s.name === 'revenue')!;

    expect(revenueSeries.data).toEqual([
      50,
      { value: 150, itemStyle: { color: '#ff4d4f' } },
      90,
      { value: 200, itemStyle: { color: '#ff4d4f' } },
    ]);
  });

  it('leaves data as plain values when no rule matches the series', () => {
    const data = {
      x: ['Jan', 'Feb'],
      y: [50, 150],
      series: [{ name: 'revenue', data: [50, 150] }],
    };
    const config = {
      ...DEFAULT_CHART_CONFIG,
      conditionalFormatting: [
        { id: 'r1', column: 'cost', operator: 'gt' as const, value: '0', bgColor: '#ff4d4f', applyTo: 'cell' as const },
      ],
    };
    const result = buildSeriesForType('bar', data as any, config, ['#00c2cb']);
    const arr = Array.isArray(result) ? result : [result];
    const revenueSeries = arr.find((s) => s.name === 'revenue')!;

    expect(revenueSeries.data).toEqual([50, 150]);
  });

  it('leaves data unchanged when no conditional formatting is configured at all', () => {
    const data = {
      x: ['Jan', 'Feb'],
      y: [50, 150],
      series: [{ name: 'revenue', data: [50, 150] }],
    };
    const result = buildSeriesForType('bar', data as any, { ...DEFAULT_CHART_CONFIG }, ['#00c2cb']);
    const arr = Array.isArray(result) ? result : [result];
    const revenueSeries = arr.find((s) => s.name === 'revenue')!;

    expect(revenueSeries.data).toEqual([50, 150]);
  });
});
