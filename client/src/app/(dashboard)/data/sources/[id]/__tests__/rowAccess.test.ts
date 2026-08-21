import { describe, expect, it } from 'vitest';
import {
  ROW_ACCESS_ALL,
  ROW_ACCESS_UNSET,
  countBypassGrants,
  isBypassGrant,
  requiresRowAccess,
  toRlsPolicyId,
} from '../_components/RowAccessSelect';

describe('requiresRowAccess', () => {
  it('requires a choice when query is granted', () => {
    expect(requiresRowAccess(['view', 'query'])).toBe(true);
    expect(requiresRowAccess(['view', 'query', 'edit', 'manage', 'share'])).toBe(true);
  });

  it('does not apply without query — RLS only wraps query execution', () => {
    expect(requiresRowAccess(['view'])).toBe(false);
    expect(requiresRowAccess([])).toBe(false);
    expect(requiresRowAccess(['view', 'edit'])).toBe(false);
  });
});

describe('toRlsPolicyId', () => {
  it('maps "all rows" to null and a policy id to itself', () => {
    expect(toRlsPolicyId(ROW_ACCESS_ALL)).toBeNull();
    expect(toRlsPolicyId('policy-7')).toBe('policy-7');
  });

  it('refuses to persist an unset choice', () => {
    expect(() => toRlsPolicyId(ROW_ACCESS_UNSET)).toThrow();
  });
});

describe('isBypassGrant', () => {
  // Mirrors apply_sql_rls: the bypass check only sees grants returned by
  // get_applicable_grants(..., DATA_SOURCE_PERMISSION_QUERY, ...).
  it('flags a query grant with no policy', () => {
    expect(isBypassGrant({ permissions: ['view', 'query'], rls_policy_id: null })).toBe(true);
  });

  it('does not flag a view-only grant with no policy', () => {
    expect(isBypassGrant({ permissions: ['view'], rls_policy_id: null })).toBe(false);
  });

  it('does not flag a query grant that has a policy', () => {
    expect(isBypassGrant({ permissions: ['view', 'query'], rls_policy_id: 'policy-1' })).toBe(false);
  });

  it('treats undefined and empty-string policy ids as no policy', () => {
    expect(isBypassGrant({ permissions: ['query'] })).toBe(true);
    expect(isBypassGrant({ permissions: ['query'], rls_policy_id: '' })).toBe(true);
  });
});

describe('countBypassGrants', () => {
  it('counts only the bypassing grants', () => {
    expect(
      countBypassGrants([
        { permissions: ['view', 'query'], rls_policy_id: null },
        { permissions: ['view', 'query'], rls_policy_id: 'p1' },
        { permissions: ['view'], rls_policy_id: null },
        { permissions: ['query'], rls_policy_id: undefined },
      ])
    ).toBe(2);
  });
});
