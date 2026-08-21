'use client';

import React from 'react';
import { Select, Tag } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DataSourceCLSPolicy, DataSourceGrantPermission } from '@/api/dataSources';

export const COLUMN_ACCESS_UNSET = '__unset__';
export const COLUMN_ACCESS_ALL = '__all__';

export type ColumnAccessValue = string;

export const requiresColumnAccess = (permissions: DataSourceGrantPermission[]): boolean =>
  permissions.includes('query');

export const toClsPolicyId = (value: ColumnAccessValue): string | null => {
  if (value === COLUMN_ACCESS_UNSET) {
    throw new Error('Column access must be chosen before a grant can be saved');
  }
  return value === COLUMN_ACCESS_ALL ? null : value;
};

export const fromClsPolicyId = (policyId?: string | null): ColumnAccessValue =>
  policyId ? policyId : COLUMN_ACCESS_ALL;

export const ColumnAccessSelect: React.FC<{
  value: ColumnAccessValue;
  onChange: (value: ColumnAccessValue) => void;
  policies: DataSourceCLSPolicy[];
  disabled?: boolean;
  style?: React.CSSProperties;
}> = ({ value, onChange, policies, disabled, style }) => {
  const t = useTranslations('data_source_detail');

  return (
    <Select<ColumnAccessValue>
      value={value}
      onChange={onChange}
      disabled={disabled}
      status={value === COLUMN_ACCESS_UNSET ? 'warning' : undefined}
      style={{ minWidth: 260, ...style }}
      optionLabelProp="label"
      options={[
        ...(value === COLUMN_ACCESS_UNSET
          ? [{ value: COLUMN_ACCESS_UNSET, label: t('column_access_choose'), disabled: true }]
          : []),
        {
          value: COLUMN_ACCESS_ALL,
          label: t('column_access_all_columns'),
          title: t('column_access_all_columns'),
        },
        ...policies.map((policy) => ({ value: policy.id, label: policy.name, title: policy.name })),
      ]}
      optionRender={(option) =>
        option.value === COLUMN_ACCESS_ALL ? (
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

export default ColumnAccessSelect;
