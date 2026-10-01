import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_TEXT,
  bulletParts,
  funnelLabels,
  heatmapScale,
  histogramParts,
  sankeyParts,
  waterfallItems,
} from '../extendedCharts';
import { buildChartOptions } from '../ChartOptionsBuilder';

const fmt = (v: number) => String(v);
const T = DEFAULT_CHART_TEXT;

describe('sankey', () => {
  it('builds positive flows and keeps a name used on both sides as two nodes', () => {
    const parts = sankeyParts(
      { x: ['ABA', 'ABA', 'Cash'], group_field: ['Payroll', 'Cash', 'Rent'], y: [10, 5, -3] } as never,
      ['#111', '#222'],
      fmt,
      T,
    );
    const series = (parts.series as Array<{ data: Array<{ name: string }>; links: Array<{ source: string; target: string }> }>)[0];
    // The negative flow is dropped; "Cash" as a destination is a different node from "Cash" as a source.
    expect(series.links).toHaveLength(2);
    const cashTarget = series.links.find((l) => l.source === 'ABA' && l.target.startsWith('Cash'))!;
    expect(cashTarget.target).not.toBe('Cash');
    expect(new Set(series.data.map((n) => n.name)).size).toBe(series.data.length);
  });
});

describe('histogram', () => {
  it('labels each bar with its value range and draws touching bars', () => {
    const parts = histogramParts({ x: [0, 500], y: [3, 1], bins: [[0, 500], [500, 1000]] } as never, '#0aa', fmt, T);
    expect(parts.categories).toEqual(['0–500', '500–1000']);
    expect((parts.series as Array<{ barCategoryGap: string }>)[0].barCategoryGap).toBe('2%');
  });

  it('renders through the chart builder with range labels on the axis', () => {
    const option = buildChartOptions('histogram', { x: [0, 500], y: [3, 1], bins: [[0, 500], [500, 1000]] } as never, {});
    expect(option.xAxis[0].data).toHaveLength(2);
    expect(option.series[0].type).toBe('bar');
  });
});

describe('waterfall', () => {
  it('floats each step from the running total, also below zero, and closes with a total', () => {
    const items = waterfallItems([100, -250, 40], true);
    expect(items.map((i) => [i.start, i.end])).toEqual([[0, 100], [100, -150], [-150, -110], [0, -110]]);
    expect(items.map((i) => i.kind)).toEqual(['up', 'down', 'up', 'total']);
  });

  it('adds a Total category and no invisible helper series', () => {
    const option = buildChartOptions('waterfall', { x: ['A', 'B'], y: [5, -2] } as never, {});
    expect(option.xAxis[0].data).toEqual(['A', 'B', 'Total']);
    expect(option.series.every((s: { type: string }) => s.type === 'custom')).toBe(true);
  });
});

describe('bullet', () => {
  it('reads the target from y2 (not the actual) and sizes bands from each target', () => {
    const parts = bulletParts(
      { x: ['Paid', 'Open'], y: [90, 20], y2: [100, 50], series: [{ name: 'Total', data: [90, 20] }] } as never,
      '#0aa',
      fmt,
      T,
      { warnPct: 60, okPct: 80 },
    );
    const series = parts.series as Array<{ type: string; data: Array<number | number[]> }>;
    const bands = series.slice(0, 3).map((s) => s.data);
    expect(bands[0]).toEqual([60, 30]); // poor: 0–60% of each row's target
    expect(bands[1]).toEqual([20, 10]); // fair: 60–80%
    const marks = series.find((s) => s.type === 'scatter')!;
    expect(marks.data).toEqual([[100, 0], [50, 1]]);
  });

  it('draws no bands or target line when there is no target', () => {
    const parts = bulletParts({ x: ['A'], y: [0.4] } as never, '#0aa', fmt, T, { warnPct: 60, okPct: 80 });
    const series = parts.series as Array<{ type: string }>;
    expect(series).toHaveLength(1); // the actual bar only: no bands, no target marks
    // Small values keep a small axis (no forced 0–110).
    expect(parts.valueMax as number).toBeLessThan(1);
  });
});

describe('funnel and heatmap', () => {
  it('reads values from series when y is empty and labels shares of the top stage', () => {
    const f = funnelLabels({ x: ['Visit', 'Buy'], y: [], series: [{ name: 'n', data: [200, 50] }] } as never, fmt, T);
    expect(f.data).toEqual([{ name: 'Visit', value: 200 }, { name: 'Buy', value: 50 }]);
    const label = (f.label as { formatter: (p: { name: string; value: number }) => string }).formatter({ name: 'Buy', value: 50 });
    expect(label).toContain('25%');
  });

  it('never produces an infinite colour scale on empty data', () => {
    const s = heatmapScale([], fmt);
    expect(Number.isFinite(s.min) && Number.isFinite(s.max)).toBe(true);
  });
});
