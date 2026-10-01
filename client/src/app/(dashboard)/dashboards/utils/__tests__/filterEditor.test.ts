import { describe, expect, it } from 'vitest';
import { columnKind, operatorForColumn, operatorsFor, valueInputFor } from '../filterEditor';

describe('filter editor', () => {
  it('reads the column kind from any database type name', () => {
    expect(columnKind('TIMESTAMP WITH TIME ZONE')).toBe('date');
    expect(columnKind('DECIMAL(10,2)')).toBe('number');
    expect(columnKind('boolean')).toBe('boolean');
    expect(columnKind('VARCHAR')).toBe('text');
    expect(columnKind(undefined)).toBe('text');
  });

  it('offers only operators that fit the column', () => {
    const date = operatorsFor('date').map((o) => o.value);
    expect(date).not.toContain('like');
    expect(operatorsFor('text').map((o) => o.value)).not.toContain('>');
    expect(operatorsFor('text')[0].value).toBe('=');
  });

  it('picks the value input from kind and operator', () => {
    expect(valueInputFor('date', '>=', true)).toBe('date');
    expect(valueInputFor('number', '>', true)).toBe('number');
    expect(valueInputFor('number', '=', true)).toBe('pick');
    expect(valueInputFor('text', 'in', false)).toBe('multi');
    expect(valueInputFor('text', 'like', true)).toBe('text');
    expect(valueInputFor('text', 'is_null', true)).toBe('none');
    expect(valueInputFor('boolean', '=', true)).toBe('boolean');
  });

  it('keeps the operator across columns only when it still fits', () => {
    expect(operatorForColumn('number', '>')).toBe('>');
    expect(operatorForColumn('text', '>')).toBe('=');
    expect(operatorForColumn('date', 'like')).toBe('=');
  });
});
