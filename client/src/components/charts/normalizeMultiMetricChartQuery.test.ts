import {
  orientDataForHorizontalBar,
  promoteChartQueryToMultiMetrics,
} from './normalizeMultiMetricChartQuery';

describe('promoteChartQueryToMultiMetrics', () => {
  it('promotes singular yMetric column + queryResult numerics into yMetrics', () => {
    const rows = [
      {
        'Branch Name': 'Branch 1',
        'Total Principal Amount': 1451528.75,
        'Total Outstanding Principal': 1186671.31,
      },
      {
        'Branch Name': 'Branch 2',
        'Total Principal Amount': 1157420.48,
        'Total Outstanding Principal': 1010171.98,
      },
    ];
    const q = promoteChartQueryToMultiMetrics(
      { x: 'Branch Name', yMetric: 'Total Principal Amount' },
      {
        queryResult: rows,
        measureHints: ['Total Principal Amount', 'Total Outstanding Principal'],
      },
    );
    expect(q.x).toBe('Branch Name');
    expect(q.yMetric).toBe('none');
    expect(q.yMetrics?.map((m) => m.field)).toEqual([
      'Total Principal Amount',
      'Total Outstanding Principal',
    ]);
    expect(q.yMetrics?.every((m) => m.aggregation === 'none')).toBe(true);
    expect(q.groupField).toBeUndefined();
  });

  it('keeps existing yMetrics when already multi-measure', () => {
    const q = promoteChartQueryToMultiMetrics({
      x: 'month',
      yMetrics: [
        { field: 'revenue', aggregation: 'sum' },
        { field: 'cost', aggregation: 'sum' },
      ],
      yMetric: 'sum',
    });
    expect(q.yMetrics).toHaveLength(2);
    expect(q.yMetrics?.[0].field).toBe('revenue');
  });

  it('infers X + multi measures from mixed-type query results', () => {
    const rows = [
      { region: 'North', revenue: 10, units: 2 },
      { region: 'South', revenue: 20, units: 5 },
    ];
    const q = promoteChartQueryToMultiMetrics({}, { queryResult: rows });
    expect(q.x).toBe('region');
    expect(q.yMetrics?.map((m) => m.field).sort()).toEqual(['revenue', 'units']);
    expect(q.groupField).toBeUndefined();
  });

  it('infers legend break-by when one measure and two dimensions', () => {
    const rows = [
      { month: 'Jan', region: 'North', revenue: 10 },
      { month: 'Jan', region: 'South', revenue: 12 },
      { month: 'Feb', region: 'North', revenue: 14 },
    ];
    const q = promoteChartQueryToMultiMetrics(
      { x: 'month', yMetrics: [{ field: 'revenue', aggregation: 'none' }] },
      { queryResult: rows },
    );
    expect(q.x).toBe('month');
    expect(q.yMetrics).toHaveLength(1);
    expect(q.groupField).toBe('region');
  });

  it('fills drillPath when three category levels exist', () => {
    const rows = [
      { year: '2024', region: 'North', city: 'A', revenue: 10 },
      { year: '2024', region: 'South', city: 'B', revenue: 12 },
    ];
    const q = promoteChartQueryToMultiMetrics(
      { x: 'year', yMetrics: [{ field: 'revenue', aggregation: 'none' }] },
      { queryResult: rows },
    );
    expect(q.groupField).toBe('region');
    expect(q.drillPath).toContain('city');
  });
});

describe('orientDataForHorizontalBar', () => {
  it('reverses categories and series so first SQL row appears at top', () => {
    const data = {
      x: ['a', 'b', 'c'],
      y: [1, 2, 3],
      series: [
        { name: 's1', data: [10, 20, 30] },
        { name: 's2', data: [4, 5, 6] },
      ],
    };
    const oriented = orientDataForHorizontalBar(data);
    expect(oriented.x).toEqual(['c', 'b', 'a']);
    expect(oriented.series?.[0].data).toEqual([30, 20, 10]);
    expect(oriented.series?.[1].data).toEqual([6, 5, 4]);
  });
});
