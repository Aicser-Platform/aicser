import { describe, expect, it } from 'vitest';
import { filterRowToString, stringToFilterRow } from '@/utils/semanticFilterGrammar';

describe('filterRowToString', () => {
  it('quotes string values', () => {
    expect(filterRowToString({ field: 'status', op: '!=', value: 'refunded' }))
      .toBe("status != 'refunded'");
  });
  it('leaves numeric values unquoted', () => {
    expect(filterRowToString({ field: 'amount', op: '>', value: '100' }))
      .toBe('amount > 100');
  });
  it('escapes single quotes in values', () => {
    expect(filterRowToString({ field: 'name', op: '=', value: "O'Brien" }))
      .toBe("name = 'O''Brien'");
  });
});

describe('stringToFilterRow', () => {
  it('round-trips a quoted string filter', () => {
    expect(stringToFilterRow("status != 'refunded'"))
      .toEqual({ field: 'status', op: '!=', value: 'refunded' });
  });
  it('round-trips a numeric filter', () => {
    expect(stringToFilterRow('amount > 100'))
      .toEqual({ field: 'amount', op: '>', value: '100' });
  });
  it('returns null for anything outside the grammar', () => {
    expect(stringToFilterRow("status != 'x' OR 1=1")).toBeNull();
  });
});
