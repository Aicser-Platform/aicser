import { describe, expect, it } from 'vitest';
import { partitionSeriesData, pivotGroupedChartData } from './chartDataProcessing';

describe('pivotGroupedChartData', () => {
  it('pivots long-format group_field rows into wide series', () => {
    const pivoted = pivotGroupedChartData({
      x: ['A', 'A', 'B', 'B'],
      group_field: ['East', 'West', 'East', 'West'],
      series: [{ name: 'Sum of amount', data: [10, 20, 30, 40] }],
      y: [10, 20, 30, 40],
    });

    expect(pivoted.x).toEqual(['A', 'B']);
    expect(pivoted.group_field).toBeUndefined();
    expect(pivoted.series).toEqual([
      { name: 'East', data: [10, 30] },
      { name: 'West', data: [20, 40] },
    ]);
  });

  it('leaves data unchanged when group_field is missing', () => {
    const input = {
      x: ['A', 'B'],
      series: [{ name: 'Count', data: [1, 2] }],
      y: [1, 2],
    };
    expect(pivotGroupedChartData(input)).toEqual(input);
  });
});

describe('partitionSeriesData', () => {
  it('pivots legend groups for bar charts and does not mis-split as secondary', () => {
    const result = partitionSeriesData(
      {
        x: ['A', 'A'],
        group_field: ['G1', 'G2'],
        series: [
          { name: 'Primary', data: [1, 2] },
          { name: 'Secondary', data: [3, 4] },
        ],
      },
      {
        chartType: 'bar',
        chartQuery: {
          yMetrics: [{ field: 'a', aggregation: 'sum' }],
          yMetricsSecondary: [{ field: 'b', aggregation: 'sum' }],
        },
      },
    );

    expect(result.series?.map((s) => s.name)).toEqual(['G1', 'G2']);
    expect(result.secondarySeries).toBeUndefined();
    expect(result.x).toEqual(['A']);
  });

  it('splits primary/secondary series without group pivot', () => {
    const result = partitionSeriesData(
      {
        x: ['A', 'B'],
        series: [
          { name: 'Sum of a', data: [1, 2] },
          { name: 'Sum of b', data: [3, 4] },
          { name: 'Sum of c', data: [5, 6] },
        ],
      },
      {
        chartType: 'bar',
        chartQuery: {
          yMetrics: [
            { field: 'a', aggregation: 'sum' },
            { field: 'b', aggregation: 'sum' },
          ],
          yMetricsSecondary: [{ field: 'c', aggregation: 'sum' }],
        },
      },
    );

    expect(result.series).toHaveLength(2);
    expect(result.secondarySeries).toEqual([{ name: 'Sum of c', data: [5, 6] }]);
  });
});
