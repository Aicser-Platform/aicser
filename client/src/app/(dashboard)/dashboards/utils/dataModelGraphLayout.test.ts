import { describe, expect, it } from 'vitest';
import { buildRelationshipGraphLayout } from './dataModelGraphLayout';

describe('buildRelationshipGraphLayout', () => {
  it('detects star schema when fact connects to multiple dimensions', () => {
    const layout = buildRelationshipGraphLayout([
      {
        id: '1',
        data_source_id: 'ds',
        from_table: 'orders',
        from_column: 'customer_id',
        to_table: 'customers',
        to_column: 'id',
        join_type: 'LEFT',
      },
      {
        id: '2',
        data_source_id: 'ds',
        from_table: 'orders',
        from_column: 'product_id',
        to_table: 'products',
        to_column: 'id',
        join_type: 'LEFT',
      },
    ]);
    expect(layout.modelHint).toBe('star');
    expect(layout.nodes.find((n) => n.role === 'fact')?.id).toBe('orders');
    expect(layout.edges).toHaveLength(2);
  });

  it('detects snowflake when dimensions join each other', () => {
    const layout = buildRelationshipGraphLayout([
      {
        id: '1',
        data_source_id: 'ds',
        from_table: 'orders',
        from_column: 'customer_id',
        to_table: 'customers',
        to_column: 'id',
        join_type: 'LEFT',
      },
      {
        id: '2',
        data_source_id: 'ds',
        from_table: 'customers',
        from_column: 'region_id',
        to_table: 'regions',
        to_column: 'id',
        join_type: 'LEFT',
      },
    ]);
    expect(layout.modelHint).toBe('snowflake');
  });
});
