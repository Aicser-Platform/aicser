import { describe, expect, it } from 'vitest';
import { buildChatChartPinPayload } from './buildChatChartPinPayload';

describe('buildChatChartPinPayload live SQL bind', () => {
  it('does not persist a copied result grid when SQL and datasource exist', () => {
    const payload = buildChatChartPinPayload({
      title: 'Revenue',
      sqlQuery: 'SELECT region, SUM(amount) AS revenue FROM orders GROUP BY 1',
      dataSourceId: 'ds-1',
      queryResult: [{ region: 'APAC', revenue: 1200000 }],
      chartConfig: {
        aiserWidgetType: 'bar',
        xAxis: { data: ['APAC'] },
        series: [{ type: 'bar', data: [1200000] }],
      },
      executionMetadata: {
        chart_query: { xAxis: 'region', yMetric: 'revenue' },
      },
    });

    expect(payload.chartOptions.__bind).toBe('live_sql');
    expect(payload.chartOptions.sample_sql).toContain('SELECT region');
    expect(payload.chartOptions.__prefetchedChartData).toBeUndefined();
    expect(payload.dataSourceId).toBe('ds-1');
  });

  it('keeps a snapshot only when there is no live SQL', () => {
    const payload = buildChatChartPinPayload({
      title: 'Static',
      queryResult: [{ x: 1 }],
      chartConfig: {
        title: { text: 'Static' },
        series: [{ type: 'bar', data: [1] }],
        xAxis: { data: ['A'] },
      },
    });

    expect(payload.chartOptions.__bind).not.toBe('live_sql');
  });
});
