'use client';

import React from 'react';
import { Select, Tag } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DataSourceGrantPermission, DataSourceRLSPolicy } from '@/api/dataSources';

export const ROW_ACCESS_UNSET = '__unset__';
export const ROW_ACCESS_ALL = '__all__';

export type RowAccessValue = string;

type BypassCandidate = {
  permissions: DataSourceGrantPermission[];
  rls_policy_id?: string | null;
};

/**
 * RLS only wraps query execution, so a grant without `query` can never bypass it.
 * This mirrors apply_sql_rls, which reaches its bypass check only for grants
 * returned by get_applicable_grants(..., DATA_SOURCE_PERMISSION_QUERY, ...).
 */
export const requiresRowAccess = (permissions: DataSourceGrantPermission[]): boolean =>
  permissions.includes('query');

export const toRlsPolicyId = (value: RowAccessValue): string | null => {
  if (value === ROW_ACCESS_UNSET) {
    throw new Error('Row access must be chosen before a grant can be saved');
  }
  return value === ROW_ACCESS_ALL ? null : value;
};

export const fromRlsPolicyId = (policyId?: string | null): RowAccessValue =>
  policyId ? policyId : ROW_ACCESS_ALL;

export const isBypassGrant = (grant: BypassCandidate): boolean =>
  requiresRowAccess(grant.permissions) && !grant.rls_policy_id;

export const countBypassGrants = (grants: BypassCandidate[]): number =>
  grants.filter(isBypassGrant).length;

export const RowAccessSelect: React.FC<{
  value: RowAccessValue;
  onChange: (value: RowAccessValue) => void;
  policies: DataSourceRLSPolicy[];
  disabled?: boolean;
  style?: React.CSSProperties;
}> = ({ value, onChange, policies, disabled, style }) => {
  const t = useTranslations('data_source_detail');

  return (
    <Select<RowAccessValue>
      value={value}
      onChange={onChange}
      disabled={disabled}
      status={value === ROW_ACCESS_UNSET ? 'warning' : undefined}
      style={{ minWidth: 260, ...style }}
      optionLabelProp="label"
      options={[
        ...(value === ROW_ACCESS_UNSET
          ? [{ value: ROW_ACCESS_UNSET, label: t('row_access_choose'), disabled: true }]
          : []),
        {
          value: ROW_ACCESS_ALL,
          label: t('row_access_all_rows'),
          title: t('row_access_all_rows'),
        },
        ...policies.map((policy) => ({ value: policy.id, label: policy.name, title: policy.name })),
      ]}
      optionRender={(option) =>
        option.value === ROW_ACCESS_ALL ? (
          <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0 }}>
            {option.label}
          </Tag>
        ) : (
          option.label
        )
      }
    />
  );
};

export default RowAccessSelect;
