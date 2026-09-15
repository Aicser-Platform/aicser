import { describe, expect, it } from 'vitest';
import {
  applyChartDesignTemplate,
  compileDesignToEcharts,
  computeParetoFrontier,
} from '../chartDesign';

describe('chartDesign', () => {
  it('applyChartDesignTemplate ranked_bar sets horizontal + value labels', () => {
    const { design, chartOptionPatches } = applyChartDesignTemplate('ranked_bar');
    expect(design.template).toBe('ranked_bar');
    expect(design.labels?.valueOnBar).toBe(true);
    expect(chartOptionPatches.barChartType).toBe('horizontal');
    expect(chartOptionPatches.showDataLabel).toBe(true);
  });

  it('applyChartDesignTemplate efficiency_scatter enables log X and pareto', () => {
    const { design } = applyChartDesignTemplate('efficiency_scatter');
    expect(design.axis?.xScale).toBe('log');
    expect(design.marks?.pareto).toBe(true);
  });

  it('computeParetoFrontier keeps non-dominated points', () => {
    const frontier = computeParetoFrontier([
      { x: 1, y: 10 },
      { x: 2, y: 8 },
      { x: 3, y: 12 },
      { x: 4, y: 11 },
      { x: 5, y: 15 },
    ]);
    expect(frontier).toEqual([
      { x: 1, y: 10 },
      { x: 3, y: 12 },
      { x: 5, y: 15 },
    ]);
  });

  it('compileDesignToEcharts applies log scale and threshold markLine', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [{ type: 'scatter', data: [[1, 2], [10, 20], [100, 5]] }],
    };
    const out = compileDesignToEcharts(
      option,
      {
        axis: { xScale: 'log' },
        marks: { lines: [{ axis: 'y', value: 15, label: 'Target' }] },
      },
      { chartType: 'scatter' },
    );
    expect((out.xAxis as { type: string }).type).toBe('log');
    const series0 = (out.series as any[])[0];
    expect(series0.markLine.data.some((d: any) => d.yAxis === 15)).toBe(true);
  });

  it('compileDesignToEcharts adds Pareto series for efficiency scatter', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'scatter',
          data: [
            [10, 50],
            [20, 40],
            [30, 80],
            [40, 70],
          ],
        },
      ],
    };
    const out = compileDesignToEcharts(
      option,
      { marks: { pareto: true } },
      { chartType: 'scatter' },
    );
    const series = out.series as any[];
    expect(series.some((s) => s.id === 'aiser-design-pareto')).toBe(true);
  });

  it('compileDesignToEcharts does not rewrite forecast CI stacks', () => {
    const option = {
      series: [
        { name: 'Historical', type: 'line', data: [1, 2] },
        { name: 'Forecast', type: 'line', data: [3, 4] },
        { name: 'Confidence', type: 'line', stack: 'confidence-band', data: [0.5, 0.5] },
      ],
    };
    const out = compileDesignToEcharts(
      option,
      {
        labels: { valueOnBar: true },
        marks: { lines: [{ axis: 'y', value: 99, label: 'x' }], pareto: true },
      },
      { chartType: 'line' },
    );
    expect((out.series as any[]).length).toBe(3);
    expect((out.series as any[]).some((s) => s.id === 'aiser-design-pareto')).toBe(false);
    expect((out.series as any[])[0].label).toBeUndefined();
  });

  it('ranked bar turns on inside labels', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: ['A', 'B'] },
      series: [{ type: 'bar', data: [10, 20] }],
    };
    const out = compileDesignToEcharts(
      option,
      { labels: { valueOnBar: true, valuePosition: 'inside' } },
      { chartType: 'bar' },
    );
    expect((out.series as any[])[0].label.show).toBe(true);
    expect((out.series as any[])[0].label.position).toBe('inside');
  });
});
