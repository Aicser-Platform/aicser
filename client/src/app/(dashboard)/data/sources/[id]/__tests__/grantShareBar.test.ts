import { describe, expect, it } from 'vitest';
import { ROW_ACCESS_ALL, ROW_ACCESS_UNSET } from '../_components/RowAccessSelect';
import { accessLevelFor, buildGrantRequests, summarizeGrantResults } from '../_components/GrantShareBar';

describe('buildGrantRequests', () => {
  it('produces one request per selected grantee, decoding the type', () => {
    const requests = buildGrantRequests(
      ['project:p1', 'user:u1', 'org_role:r1'],
      ['view', 'query'],
      'policy-3'
    );
    expect(requests).toEqual([
      { grantee_type: 'project', grantee_id: 'p1', permissions: ['view', 'query'], rls_policy_id: 'policy-3' },
      { grantee_type: 'user', grantee_id: 'u1', permissions: ['view', 'query'], rls_policy_id: 'policy-3' },
      { grantee_type: 'org_role', grantee_id: 'r1', permissions: ['view', 'query'], rls_policy_id: 'policy-3' },
    ]);
  });

  it('persists "all rows" as a null policy id', () => {
    expect(buildGrantRequests(['user:u1'], ['view', 'query'], ROW_ACCESS_ALL)[0].rls_policy_id).toBeNull();
  });

  it('sends a null policy id for a view-only grant, where row access does not apply', () => {
    const [request] = buildGrantRequests(['user:u1'], ['view'], ROW_ACCESS_UNSET);
    expect(request.rls_policy_id).toBeNull();
  });

  it('refuses to build a query grant whose row access was never chosen', () => {
    expect(() => buildGrantRequests(['user:u1'], ['view', 'query'], ROW_ACCESS_UNSET)).toThrow();
  });
});

describe('accessLevelFor', () => {
  it('matches an exact view grant', () => {
    expect(accessLevelFor(['view'])).toBe('view');
  });

  it('matches an exact explore grant', () => {
    expect(accessLevelFor(['view', 'query'])).toBe('explore');
  });

  it('matches an exact manage grant', () => {
    expect(accessLevelFor(['view', 'query', 'edit', 'manage', 'share'])).toBe('manage');
  });

  it('matches regardless of permission order', () => {
    expect(accessLevelFor(['query', 'view'])).toBe('explore');
    expect(accessLevelFor(['share', 'manage', 'edit', 'query', 'view'])).toBe('manage');
  });

  it('falls back to custom for an unmatched combination', () => {
    expect(accessLevelFor(['view', 'edit'])).toBe('custom');
    expect(accessLevelFor([])).toBe('custom');
  });
});

describe('summarizeGrantResults', () => {
  it('separates successes from failures without discarding either', () => {
    const results = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('nope') },
      { status: 'fulfilled', value: undefined },
    ] as PromiseSettledResult<unknown>[];

    expect(summarizeGrantResults(results, ['Alice', 'Bob', 'Carol'])).toEqual({
      succeeded: ['Alice', 'Carol'],
      failed: ['Bob'],
    });
  });
});
