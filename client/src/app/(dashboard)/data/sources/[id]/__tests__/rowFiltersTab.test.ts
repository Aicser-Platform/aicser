import { describe, expect, it } from 'vitest';
import type { DataSourceAccessGrant } from '@/api/dataSources';
import { countGrantsUsingPolicy } from '../_components/RowFiltersTab';

const grants = [
  { rls_policy_id: 'p1' },
  { rls_policy_id: 'p1' },
  { rls_policy_id: 'p2' },
  { rls_policy_id: null },
] as DataSourceAccessGrant[];

describe('countGrantsUsingPolicy', () => {
  it('counts only the grants pointing at that policy', () => {
    expect(countGrantsUsingPolicy(grants, 'p1')).toBe(2);
    expect(countGrantsUsingPolicy(grants, 'p2')).toBe(1);
    expect(countGrantsUsingPolicy(grants, 'p3')).toBe(0);
  });
});
