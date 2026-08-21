'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Space, Spin, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { DataSourceRLSPolicy } from '@/api/dataSources';
import {
  useDataSourceAccessGrants,
  useDataSourceMyRowAccess,
  useDataSourceRLSPolicies,
  usePreviewDataSourceRLSPolicy,
} from '@/hooks/useDataSources';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text, Paragraph } = Typography;

type PreviewEntry = { status: 'loading' | 'success' | 'failed'; predicate?: string | null };

/**
 * Content for the "Row filter applied" chip's popover in the SQL Editor.
 *
 * Two sources, two honesty levels:
 *
 * 1. PRIMARY — `useDataSourceMyRowAccess` (`GET .../my-row-access`), gated
 *    only on QUERY permission. It reports the CALLER'S OWN effective RLS
 *    policies, so when it resolves the wording can be definite ("Filtered
 *    by policy/policies: ..."). It 403s outside EE / for callers who
 *    somehow lack query access, in which case we fall through below.
 * 2. BACKSTOP — the pre-existing admin-gated inference. The client never
 *    sees which single grant the server actually resolved for a given
 *    query, so this names CANDIDATE policies: the ones referenced by
 *    grants that match the current user or the current project. Because
 *    it's an inference (and the preview endpoint it uses requires manage
 *    permission, so it can itself fail for a viewer/query-only user), its
 *    wording stays hedged ("One or more row filter policies applied: ...")
 *    — do not "upgrade" it to the confident wording used above.
 */
export const RlsAppliedPopoverContent: React.FC<{
  dataSourceId: string | null;
  open: boolean;
  columnsOmitted?: string[];
}> = ({ dataSourceId, open, columnsOmitted = [] }) => {
  const t = useTranslations('monaco_sql_editor');
  const { user: authUser } = useAuthStore();
  const { currentProjectId } = useProjectStore();
  const {
    myRowAccess,
    isLoading: myRowAccessLoading,
    error: myRowAccessError,
  } = useDataSourceMyRowAccess(dataSourceId, open);
  const { grants, isLoading: grantsLoading, error: grantsError } = useDataSourceAccessGrants(dataSourceId, open);
  const { policies, isLoading: policiesLoading, error: policiesError } = useDataSourceRLSPolicies(
    dataSourceId,
    open
  );
  const previewPolicy = usePreviewDataSourceRLSPolicy();
  const [previews, setPreviews] = useState<Record<string, PreviewEntry>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  const ownGrants = grants.filter(
    (grant) =>
      grant.rls_policy_id &&
      ((grant.grantee_type === 'user' && grant.grantee_id === authUser?.id) ||
        (grant.grantee_type === 'project' &&
          currentProjectId != null &&
          grant.grantee_id === String(currentProjectId)))
  );
  const relevantGrants = ownGrants.length > 0 ? ownGrants : grants.filter((grant) => grant.rls_policy_id);
  const policyIds = new Set(relevantGrants.map((grant) => grant.rls_policy_id));
  const candidates: DataSourceRLSPolicy[] = policies.filter((policy) => policyIds.has(policy.id));

  const myRowAccessSettled = !(open && myRowAccessLoading);
  const primaryAlreadyUsable =
    myRowAccessSettled &&
    !myRowAccessError &&
    Boolean(myRowAccess) &&
    (myRowAccess!.unrestricted || (myRowAccess?.policies.length ?? 0) > 0);

  useEffect(() => {
    // Skip the admin-gated preview lookups once the caller-scoped primary
    // source already answered — no need to hit manage-only endpoints that
    // a query-only user can't reach anyway.
    if (!open || !dataSourceId || candidates.length === 0 || primaryAlreadyUsable) return;
    const pending = candidates.filter((policy) => !fetchedRef.current.has(policy.id));
    if (pending.length === 0) return;
    pending.forEach((policy) => fetchedRef.current.add(policy.id));
    setPreviews((prev) => {
      const next = { ...prev };
      pending.forEach((policy) => {
        next[policy.id] = { status: 'loading' };
      });
      return next;
    });
    pending.forEach((policy) => {
      previewPolicy
        .mutateAsync({ id: dataSourceId, data: { rules: policy.rules, default_deny: policy.default_deny } })
        .then((res) => {
          setPreviews((prev) => ({ ...prev, [policy.id]: { status: 'success', predicate: res.predicate ?? null } }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [policy.id]: { status: 'failed' } }));
        });
    });
    // previewPolicy is a stable mutation object; excluding it avoids a re-fire loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dataSourceId, candidates, primaryAlreadyUsable]);

  const myPolicies = myRowAccess?.policies ?? [];
  const uniqueDeniedColumns = Array.from(
    new Set([...(myRowAccess?.columns?.denied ?? []), ...columnsOmitted])
  );
  const maskedColumns = myRowAccess?.columns?.masked ?? [];
  // Primary settles quickly (single query, capped retries on 4xx — see the
  // hook), so waiting for it never leaves the popover spinning forever; once
  // it settles we either use it (usable) or fall through to the backstop.
  const primaryLoading = open && myRowAccessLoading;
  const primaryUsable = primaryAlreadyUsable;

  const adminLoading = open && (grantsLoading || policiesLoading);
  const adminUnavailable = Boolean(grantsError || policiesError) || (!adminLoading && candidates.length === 0);

  return (
    <div style={{ maxWidth: 320 }}>
      <Paragraph style={{ marginBottom: 8, fontSize: 12 }} type="secondary">
        {t('rls_applied_explainer')}
      </Paragraph>
      {primaryLoading ? (
        <Spin size="small" />
      ) : primaryUsable ? (
        myRowAccess!.unrestricted ? (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('rls_applied_my_unrestricted')}
          </Text>
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text style={{ fontSize: 12 }}>
              {myPolicies.length === 1
                ? t('rls_applied_single_policy', { name: myPolicies[0].name })
                : t('rls_applied_my_multiple_policies', {
                    names: myPolicies.map((policy) => policy.name).join(', '),
                  })}
            </Text>
            {myPolicies.map((policy) => (
              <div key={policy.id}>
                <Text strong style={{ fontSize: 12 }}>
                  {policy.name}
                </Text>
                {policy.predicates.length === 0 ? (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('rls_applied_predicate_unavailable')}
                    </Text>
                  </div>
                ) : (
                  policy.predicates.map((predicate) => (
                    <div key={`${policy.id}-${predicate.table}`}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {predicate.table}
                      </Text>
                      <div>
                        <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {predicate.sql}
                        </Text>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </Space>
        )
      ) : adminLoading ? (
        <Spin size="small" />
      ) : adminUnavailable ? (
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('rls_applied_unavailable')}
        </Text>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text style={{ fontSize: 12 }}>
            {candidates.length === 1
              ? t('rls_applied_single_policy', { name: candidates[0].name })
              : t('rls_applied_multiple_policies', { names: candidates.map((policy) => policy.name).join(', ') })}
          </Text>
          {candidates.map((policy) => {
            const preview = previews[policy.id];
            return (
              <div key={policy.id}>
                <Text strong style={{ fontSize: 12 }}>
                  {policy.name}
                </Text>
                <div>
                  {!preview || preview.status === 'loading' ? (
                    <Spin size="small" />
                  ) : preview.status === 'failed' || !preview.predicate ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('rls_applied_predicate_unavailable')}
                    </Text>
                  ) : (
                    <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      {preview.predicate}
                    </Text>
                  )}
                </div>
              </div>
            );
          })}
        </Space>
      )}
      {uniqueDeniedColumns.length > 0 || maskedColumns.length > 0 ? (
        <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 10 }}>
          <Text strong style={{ fontSize: 12 }}>
            {t('column_filters_applied')}
          </Text>
          {uniqueDeniedColumns.length > 0 ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('column_filters_omitted')}
              </Text>
              <Paragraph code style={{ marginBottom: 0, fontSize: 11, wordBreak: 'break-all' }}>
                {uniqueDeniedColumns.join(', ')}
              </Paragraph>
            </div>
          ) : null}
          {maskedColumns.length > 0 ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('column_filters_masked')}
              </Text>
              <Paragraph code style={{ marginBottom: 0, fontSize: 11, wordBreak: 'break-all' }}>
                {maskedColumns
                  .map((item) => `${item.column}${item.strategy ? ` (${item.strategy})` : ''}`)
                  .join(', ')}
              </Paragraph>
            </div>
          ) : null}
        </Space>
      ) : null}
    </div>
  );
};

export default RlsAppliedPopoverContent;
