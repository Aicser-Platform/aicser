import { describe, expect, it } from 'vitest';
import type { DataSourceAccessGrant, DataSourceRLSPolicy } from '@/api/dataSources';
import { grantEffect } from '../_components/grantEffect';

const policy = (over: Partial<DataSourceRLSPolicy> = {}): DataSourceRLSPolicy =>
  ({
    id: 'p1',
    name: 'Customer ID',
    enabled: true,
    default_deny: true,
    rules: [
      {
        id: 'r1',
        table_name: 'fact_orders',
        column_name: 'customer_id',
        operator: 'eq',
        value_type: 'user_attribute',
        value: 'email',
      },
    ],
    ...over,
  }) as DataSourceRLSPolicy;

const grant = (over: Partial<DataSourceAccessGrant> = {}): DataSourceAccessGrant =>
  ({
    id: 'g1',
    grantee_type: 'user',
    grantee_id: 'u1',
    permissions: ['view', 'query'],
    rls_policy_id: 'p1',
    ...over,
  }) as DataSourceAccessGrant;

describe('grantEffect', () => {
  it('says a view-only grant never reads rows at all', () => {
    expect(grantEffect(grant({ permissions: ['view'] }), [policy()])).toMatchObject({
      kind: 'metadata_only',
    });
  });

  it('flags a query grant with no filter as seeing everything', () => {
    expect(grantEffect(grant({ rls_policy_id: null }), [policy()])).toMatchObject({
      kind: 'all_rows',
    });
  });

  it('reports the filter and its rules when one is attached', () => {
    const effect = grantEffect(grant(), [policy()]);
    expect(effect.kind).toBe('filtered');
    expect(effect.policyName).toBe('Customer ID');
    expect(effect.rules).toHaveLength(1);
  });

  it('treats an inactive policy as denying everything, matching the engine', () => {
    // _policy_clause returns None for a disabled policy, which compiles to 1 = 0.
    expect(grantEffect(grant(), [policy({ enabled: false })]).kind).toBe('denies_all');
  });

  it('treats a grant pointing at a missing policy as denying everything', () => {
    // A deleted policy leaves the grant with nothing to resolve — the engine
    // finds no policies and collapses to WHERE 1 = 0.
    expect(grantEffect(grant({ rls_policy_id: 'gone' }), [policy()]).kind).toBe('denies_all');
  });
});
