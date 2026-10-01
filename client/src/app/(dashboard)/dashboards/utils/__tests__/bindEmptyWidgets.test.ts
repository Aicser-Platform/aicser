import { describe, expect, it } from 'vitest';
import { planEmptyWidgetBindings, isEmptyDataWidget, duplicateKpis, planKpiVariety } from '../bindEmptyWidgets';

const cols = [
  { name: 'order_id', type: 'BIGINT' },
  { name: 'order_date', type: 'DATE' },
  { name: 'store_region', type: 'VARCHAR' },
  { name: 'order_total', type: 'DOUBLE' },
  { name: 'quantity', type: 'INTEGER' },
  { name: 'discount', type: 'DECIMAL(10,2)' },
];
const w = (id: string, chartType: string, extra: Record<string, unknown> = {}) =>
  ({ id, chartType, title: 'KPI', chartQuery: {}, chartOptions: {}, ...extra }) as any;

describe('planEmptyWidgetBindings', () => {
  it('fills only the empty data widgets, spreading KPIs across measures', () => {
    const widgets = [
      w('bound', 'stat', { dataSourceId: 'ds', chartQuery: { tableName: 'orders' } }),
      w('k1', 'stat'),
      w('k2', 'stat'),
      w('k3', 'stat'),
      w('trend', 'line', { title: 'Trend' }),
      w('note', 'text'),
    ];
    const plan = planEmptyWidgetBindings(widgets, { dataSourceId: 'ds', tableName: 'orders' }, cols, {
      placeholderTitles: new Set(['KPI', 'Trend']),
    });
    expect(plan.map((p) => p.id)).toEqual(['k1', 'k2', 'k3', 'trend']);
    expect(plan.slice(0, 3).map((p) => (p.chartQuery.yMetrics as any)[0].field)).toEqual([
      'order_total',
      'quantity',
      'discount',
    ]);
    expect(plan[3].chartQuery).toMatchObject({ x: 'order_date', xGrain: 'month' });
    expect(plan[0].title).toBe('order total');
  });

  it('groups bars by a category, never by an id, and keeps user titles', () => {
    const plan = planEmptyWidgetBindings([w('b', 'bar', { title: 'My chart' })], { dataSourceId: 'ds', tableName: 'orders' }, cols, {
      placeholderTitles: new Set(['KPI']),
    });
    expect(plan[0].chartQuery.x).toBe('store_region');
    expect(plan[0].title).toBeUndefined();
  });

  it('treats SQL-bound widgets as bound', () => {
    expect(isEmptyDataWidget(w('s', 'bar', { chartQuery: { saved_query_id: 'q' } }))).toBe(false);
    expect(isEmptyDataWidget(w('e', 'bar'))).toBe(true);
  });
});

describe('KPI variety', () => {
  it('gives each KPI a different metric even with a single measure', () => {
    const kpi = (id: string) => ({ id, title: 'KPI', chartType: 'stat', chartQuery: {} }) as never;
    const plan = planEmptyWidgetBindings(
      [kpi('a'), kpi('b'), kpi('c')],
      { dataSourceId: 'ds', tableName: 'orders' },
      [
        { name: 'order_id', type: 'INTEGER' },
        { name: 'store_id', type: 'INTEGER' },
        { name: 'order_total', type: 'DECIMAL' },
        { name: 'order_date', type: 'DATE' },
      ],
      { taken: [{ field: 'order_total', aggregation: 'sum' }] },
    );
    const metrics = plan.map((b) => JSON.stringify((b.chartQuery.yMetrics as unknown[])[0]));
    expect(new Set(metrics).size).toBe(3);
    expect(metrics[0]).toContain('"count"');
  });
});

describe('duplicate KPIs', () => {
  const kpi = (id: string, field: string, aggregation = 'sum', extra: Record<string, unknown> = {}) =>
    w(id, 'stat', { dataSourceId: 'ds', chartQuery: { tableName: 'orders', yMetrics: [{ field, aggregation }] }, ...extra });

  it('finds cards that repeat an earlier card, ignoring SQL-bound and other tables', () => {
    const widgets = [
      kpi('a', 'order_total'),
      kpi('b', 'order_total'),
      kpi('c', 'quantity'),
      kpi('d', 'order_total'),
      kpi('e', 'order_total', 'sum', { chartQuery: { tableName: 'returns', yMetrics: [{ field: 'order_total', aggregation: 'sum' }] } }),
      kpi('f', 'order_total', 'sum', { chartQuery: { saved_query_id: 'q', tableName: 'orders', yMetrics: [{ field: 'order_total', aggregation: 'sum' }] } }),
    ];
    expect(duplicateKpis(widgets).map((x) => x.id)).toEqual(['b', 'd']);
  });

  it('gives each repeat a metric nobody shows yet, keeping the rest of its query', () => {
    const dupes = [kpi('b', 'order_total'), kpi('d', 'order_total')];
    const plan = planKpiVariety(dupes, cols, [
      { field: 'order_total', aggregation: 'sum' },
      { field: 'quantity', aggregation: 'sum' },
    ]);
    expect(plan.map((p) => (p.chartQuery.yMetrics as any)[0])).toEqual([
      { field: 'discount', aggregation: 'sum' },
      { field: 'order_id', aggregation: 'count' },
    ]);
    expect(plan[0].chartQuery.tableName).toBe('orders');
  });

  it('leaves repeats alone when the table has nothing new to show', () => {
    const tiny = [{ name: 'amount', type: 'DOUBLE' }];
    const taken = [
      { field: 'amount', aggregation: 'sum' },
      { field: 'amount', aggregation: 'count' },
      { field: 'amount', aggregation: 'avg' },
    ];
    expect(planKpiVariety([kpi('b', 'amount')], tiny, taken)).toEqual([]);
  });

  it('on a lookup table with no measures, counts the distinct values of a category', () => {
    const lookup = [
      { name: 'account_id', type: 'INTEGER' },
      { name: 'account_name', type: 'VARCHAR' },
      { name: 'account_type', type: 'VARCHAR' },
    ];
    const plan = planKpiVariety([kpi('b', 'account_id', 'count')], lookup, [
      { field: 'account_id', aggregation: 'count' },
      { field: 'account_name', aggregation: 'distinct_count' },
    ]);
    expect((plan[0].chartQuery.yMetrics as any)[0]).toEqual({ field: 'account_type', aggregation: 'distinct_count' });
  });
});
