import { describe, expect, it } from 'vitest';
import { columnEntry, guessRole, roleFor } from '../columnRoles';

describe('column roles', () => {
  it('guesses a starting role from name and type', () => {
    expect(guessRole('customer_id', 'BIGINT')).toBe('id');
    expect(guessRole('amount', 'DECIMAL(12,2)')).toBe('amount');
    expect(guessRole('ordered_at', 'TIMESTAMP')).toBe('date');
    expect(guessRole('region', 'VARCHAR')).toBe('category');
    expect(guessRole('fiscal_month', 'INTEGER')).toBe('category');
  });

  it('reads entries however they were keyed, like the server', () => {
    const m = { 'banking.accounts.balance': 'a', 'orders.amount': 'b', region: 'c' };
    expect(columnEntry(m, 'accounts', 'balance')).toBe('a');
    expect(columnEntry(m, 'banking.accounts', 'BALANCE')).toBe('a');
    expect(columnEntry(m, 'orders', 'amount')).toBe('b');
    expect(columnEntry(m, 'data', 'region')).toBe('c');
    expect(columnEntry(m, 'orders', 'none')).toBeUndefined();
  });

  it('prefers what people set over the guess', () => {
    expect(roleFor({ column_roles: { 'orders.branch_code': 'category' } }, 'orders', 'branch_code', 'INTEGER')).toEqual({ role: 'category', set: true });
    expect(roleFor({ column_roles: { x: 'bogus' } }, 'orders', 'x', 'INTEGER')).toEqual({ role: 'amount', set: false });
  });
});
