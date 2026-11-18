import type { Relationship } from '@/api/semanticStudio';
import { metricStatus, type Metric } from '@/api/semanticStudio';
import { cardinalityLabel, handleColumn, handleId, layoutTables, linkSides, NODE_WIDTH } from './diagram';
import { isSingleTableSource, readinessOf, sectionFor } from './readiness';

const rel = (from: string, to: string, extra: Partial<Relationship> = {}): Relationship => ({
  id: `${from}-${to}`,
  from_table: from,
  from_column: 'id',
  to_table: to,
  to_column: `${from}_id`,
  join_type: 'LEFT',
  cardinality: 'one_to_many',
  is_active: true,
  ...extra,
});
const table = (name: string, columns = ['id']) => ({ name, columns: columns.map((c) => ({ name: c, type: 'text' })) });

describe('semantic readiness (web semanticReadiness)', () => {
  it('reads the next step from the counts', () => {
    expect(readinessOf({})).toBe('needs_relationships');
    expect(readinessOf({}, true)).toBe('needs_metrics');
    expect(readinessOf({ join_count: 2 })).toBe('needs_metrics');
    expect(readinessOf({ metric_count: 3, join_count: 1 })).toBe('needs_certification');
    expect(readinessOf({ metric_count: 2, certified_metric_count: 1 })).toBe('ready');
    expect(sectionFor('needs_relationships')).toBe('joins');
    expect(sectionFor('needs_metrics')).toBe('metrics');
  });

  it('treats a one-table file as needing no joins', () => {
    expect(isSingleTableSource('file', null)).toBe(true);
    expect(isSingleTableSource('database', 4)).toBe(false);
    expect(isSingleTableSource('database', 1)).toBe(true);
  });
});

describe('metric status', () => {
  const m = (extra: Partial<Metric>): Metric => ({ id: 'm', name: 'm', expression: 'COUNT(*)', ...extra });
  it('is official, changed, retired or draft', () => {
    expect(metricStatus(m({ certified: true }))).toBe('official');
    expect(metricStatus(m({ certified: true, pending_change: { expression: 'SUM(x)' } }))).toBe('changed');
    expect(metricStatus(m({ certified: true, deprecated_at: '2026-01-01' }))).toBe('retired');
    expect(metricStatus(m({}))).toBe('draft');
  });
});

describe('relationship diagram layout', () => {
  it('puts joined tables in columns from the most connected one, unjoined last', () => {
    const placed = layoutTables(
      [table('order_items'), table('orders'), table('customers'), table('products'), table('notes')],
      [rel('orders', 'order_items'), rel('customers', 'orders'), rel('products', 'order_items')]
    );
    const x = Object.fromEntries(placed.map((p) => [p.name, p.x]));
    // orders and order_items have 2 links; order_items sorts first, so it is column 0.
    expect(x.order_items).toBe(24);
    expect(x.orders).toBe(x.products);
    expect(x.customers).toBeGreaterThan(x.orders!);
    expect(x.notes).toBeGreaterThan(x.customers!);
  });

  it('links leave and enter by the sides facing each other', () => {
    expect(linkSides(0, 400)).toEqual({ source: 'r', target: 'l' });
    expect(linkSides(400, 0)).toEqual({ source: 'l', target: 'r' });
    expect(linkSides(0, NODE_WIDTH / 4)).toEqual({ source: 'l', target: 'l' });
    expect(handleColumn(handleId('r', 'customer_id'))).toBe('customer_id');
    expect(handleColumn('l:')).toBeNull();
    expect(cardinalityLabel('one_to_many')).toBe('1:N');
  });
});
