import { describe, expect, it } from 'vitest';
import { resolveRuntimeFiltersForWidget } from '../filterOperators';

const click = { field: 'account_code', operator: '=', value: '4200', type: 'simple', crossFilter: true };
const control = { field: 'account_code', operator: '=', value: '4200', type: 'simple' };

describe('cross-filter scope', () => {
  it('keeps the clicked chart whole so it can highlight the selection', () => {
    const source = { id: 'a', chartQuery: { x: 'account_code' } };
    expect(resolveRuntimeFiltersForWidget([click], [], source)).toEqual([]);
  });

  it('narrows every other widget', () => {
    const kpi = { id: 'b', chartQuery: { yMetrics: [{ field: 'amount', aggregation: 'sum' }] } };
    expect(resolveRuntimeFiltersForWidget([click], [], kpi)).toEqual([click]);
  });

  it('still applies a filter control to a chart grouped by that field', () => {
    const source = { id: 'a', chartQuery: { x: 'account_code' } };
    expect(resolveRuntimeFiltersForWidget([control], [], source)).toEqual([control]);
  });
});
