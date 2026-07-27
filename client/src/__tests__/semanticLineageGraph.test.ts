import { describe, expect, it } from 'vitest';
import { lineageToFlow } from '@/utils/semanticLineageGraph';
import type { SemanticLineage } from '@/types/semanticWorkbench';

const LINEAGE: SemanticLineage = {
  source: { id: 'ds-1', name: 'AccountingDataSet' },
  tables: [
    { name: 'orders', source: 'db.public.orders', description: 'Orders', columns: [] },
    { name: 'order_items', source: 'db.public.order_items', description: 'Items', columns: [] },
  ],
  joins: [{
    from_table: 'order_items', from_column: 'order_id',
    to_table: 'orders', to_column: 'order_id', join_type: 'many_to_one',
  }],
  metrics: [{
    name: 'total_revenue', table: 'orders', type: 'simple',
    format: 'currency_usd', certified: true, description: 'Revenue',
  }],
};

describe('lineageToFlow', () => {
  it('creates one node per source, table, and metric', () => {
    const { nodes } = lineageToFlow(LINEAGE);
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'metric:total_revenue', 'source:ds-1', 'table:order_items', 'table:orders',
    ]);
  });
  it('wires source→table, join, and table→metric edges', () => {
    const { edges } = lineageToFlow(LINEAGE);
    const pairs = edges.map((e) => `${e.source}→${e.target}`).sort();
    expect(pairs).toEqual([
      'source:ds-1→table:order_items',
      'source:ds-1→table:orders',
      'table:order_items→table:orders',
      'table:orders→metric:total_revenue',
    ]);
  });
  it('can build a table-only data model graph without metric nodes', () => {
    const { nodes, edges } = lineageToFlow(LINEAGE, { includeMetrics: false });
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'source:ds-1', 'table:order_items', 'table:orders',
    ]);
    expect(edges.some((e) => e.kind === 'metric')).toBe(false);
    expect(edges.map((e) => `${e.source}→${e.target}`).sort()).toEqual([
      'source:ds-1→table:order_items',
      'source:ds-1→table:orders',
      'table:order_items→table:orders',
    ]);
  });
  it('labels join edges with the join condition', () => {
    const { edges } = lineageToFlow(LINEAGE);
    const join = edges.find((e) => e.source === 'table:order_items' && e.target === 'table:orders');
    expect(join?.label).toBe('order_items.order_id = orders.order_id');
    expect(join?.kind).toBe('relationship');
  });
  it('assigns finite positions to every node (dagre layout ran)', () => {
    const { nodes } = lineageToFlow(LINEAGE);
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // dagre must actually lay nodes out, not leave them all stacked at the origin
    const uniquePositions = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(uniquePositions.size).toBeGreaterThan(1);
  });
});
