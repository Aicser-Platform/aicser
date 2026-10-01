import { describe, expect, it } from 'vitest';
import { pivot, shapeChart } from '../components/chartShape';

const columns = ['region', 'year', 'sales'];
const rows = [
  ['North', 2024, 10],
  ['North', 2025, 20],
  ['South', 2024, 5],
  ['South', 2024, 7],
  ['East', 2025, null],
];

describe('shapeChart', () => {
  it('sums by category and sorts by value', () => {
    const s = shapeChart(columns, rows, { x: 'region', y: ['sales'], agg: 'sum' });
    expect(s.categories).toEqual(['North', 'South', 'East']);
    expect(s.series[0].data).toEqual([30, 12, null]);
  });

  it('averages ignore blanks and counts do not need a measure', () => {
    expect(shapeChart(columns, rows, { x: 'region', y: ['sales'], agg: 'avg' }).series[0].data).toEqual([15, 6, null]);
    expect(shapeChart(columns, rows, { x: 'region', y: [], agg: 'count' }).series[0].data).toEqual([2, 2, 1]);
  });

  it('splits into one series per value of the split column', () => {
    const s = shapeChart(columns, rows, { x: 'region', y: ['sales'], agg: 'sum', series: 'year' });
    expect(s.series.map((x) => x.name).sort()).toEqual(['2024', '2025']);
  });

  it('folds the tail into Other for additive summaries', () => {
    const s = shapeChart(columns, rows, { x: 'region', y: ['sales'], agg: 'sum', limit: 2 }, 'Other');
    expect(s.categories).toEqual(['North', 'Other']);
    expect(s.series[0].data).toEqual([30, 12]);
    expect(s.total).toBe(3);
  });

  it('bars can show only the top N, without an Other bucket', () => {
    const s = shapeChart(columns, rows, { x: 'region', y: ['sales'], agg: 'sum', limit: 2, fold: false });
    expect(s.categories).toEqual(['North', 'South']);
    expect(s.total).toBe(3);
  });

  it('orders numeric x by value, not by total', () => {
    const s = shapeChart(columns, rows, { x: 'year', y: ['sales'], agg: 'sum' });
    expect(s.categories).toEqual(['2024', '2025']);
  });
});

describe('pivot', () => {
  it('cross-tabulates with row, column and grand totals', () => {
    const p = pivot(columns, rows, { rows: ['region'], columns: ['year'], values: ['sales'], agg: 'sum' });
    expect(p.colKeys.map((c) => c.col)).toEqual(['2024', '2025']);
    const north = p.body.find((b) => b.keys[0] === 'North')!;
    expect(north.cells).toEqual([10, 20]);
    expect(north.total).toBe(30);
    expect(p.totals).toEqual([22, 20]);
    expect(p.grand).toBe(42);
  });

  it('averages totals over the underlying rows, not over the cells', () => {
    const p = pivot(columns, rows, { rows: ['region'], values: ['sales'], agg: 'avg' });
    expect(p.totals[0]).toBeCloseTo(42 / 4);
  });
});
