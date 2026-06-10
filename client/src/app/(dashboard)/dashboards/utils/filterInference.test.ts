import { describe, expect, it } from 'vitest';
import {
  buildSmartFilterDraft,
  inferFilterLabel,
  inferFilterTypeFromColumn,
} from './filterInference';

describe('filterInference', () => {
  it('infers date range from timestamp columns', () => {
    expect(inferFilterTypeFromColumn({ name: 'created_at', type: 'timestamp' })).toBe('dateRange');
  });

  it('infers slider from numeric columns', () => {
    expect(inferFilterTypeFromColumn({ name: 'amount', type: 'float' })).toBe('slider');
  });

  it('infers search for high cardinality hints', () => {
    expect(inferFilterTypeFromColumn({ name: 'description', type: 'text' }, { cardinalityHint: 'high' })).toBe(
      'search',
    );
  });

  it('formats filter labels from snake_case fields', () => {
    expect(inferFilterLabel('order_status')).toBe('Order Status');
  });

  it('builds smart filter draft with auto affects scope', () => {
    const draft = buildSmartFilterDraft({
      field: 'region',
      columnType: 'varchar',
      dataSourceId: 'ds-1',
      tableName: 'orders',
      widgetIdsUsingField: ['w1', 'w2'],
    });
    expect(draft.type).toBe('dropdown');
    expect(draft.name).toBe('Region');
    expect(draft.affects).toEqual(['w1', 'w2']);
    expect(draft.dataSourceId).toBe('ds-1');
  });
});
