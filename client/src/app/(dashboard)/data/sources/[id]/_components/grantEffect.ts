/**
 * What a grant actually yields, in the same terms the engine uses.
 *
 * The Permissions table shows who has access; this answers the question the
 * admin is really asking — what will they see when they run a query.
 */

import type { DataSourceAccessGrant, DataSourceRLSPolicy, DataSourceRLSRule } from '@/api/dataSources';

export type GrantEffectKind =
  /** No query permission, so row security never comes into play. */
  | 'metadata_only'
  /** Query permission with no filter — reads every row, and disables filtering source-wide. */
  | 'all_rows'
  /** A filter applies. */
  | 'filtered'
  /** Resolves to no rows: the policy is off, or gone. */
  | 'denies_all';

export type GrantEffect = {
  kind: GrantEffectKind;
  policyName?: string;
  rules: DataSourceRLSRule[];
};

export const grantEffect = (
  grant: DataSourceAccessGrant,
  policies: DataSourceRLSPolicy[]
): GrantEffect => {
  if (!grant.permissions.includes('query')) {
    return { kind: 'metadata_only', rules: [] };
  }
  if (!grant.rls_policy_id) {
    return { kind: 'all_rows', rules: [] };
  }

  const policy = policies.find((item) => item.id === grant.rls_policy_id);
  // A deleted policy leaves nothing to resolve, and a disabled one compiles to
  // 1 = 0 rather than "no filter". Both mean the holder sees nothing.
  if (!policy || !policy.enabled) {
    return { kind: 'denies_all', policyName: policy?.name, rules: policy?.rules ?? [] };
  }

  return { kind: 'filtered', policyName: policy.name, rules: policy.rules };
};
