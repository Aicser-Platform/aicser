'use client';

import React, { useMemo, useState } from 'react';
import { Button, Card, Select, Space, Typography, message } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type {
  DataSourceAccessGrantRequest,
  DataSourceCLSPolicy,
  DataSourceGrantPermission,
  DataSourceRLSPolicy,
} from '@/api/dataSources';
import { useUpsertDataSourceAccessGrant } from '@/hooks/useDataSources';
import {
  decodeGranteeValue,
  encodeGranteeValue,
  useGranteeDirectory,
  type SupportedGranteeType,
} from '@/hooks/access/useGranteeOptions';
import RowAccessSelect, {
  ROW_ACCESS_UNSET,
  requiresRowAccess,
  toRlsPolicyId,
  type RowAccessValue,
} from './RowAccessSelect';
import ColumnAccessSelect, {
  COLUMN_ACCESS_UNSET,
  requiresColumnAccess,
  toClsPolicyId,
  type ColumnAccessValue,
} from './ColumnAccessSelect';

export type AccessLevelKey = 'view' | 'explore' | 'manage' | 'custom';

export const ACCESS_LEVELS: Array<{ key: AccessLevelKey; permissions: DataSourceGrantPermission[] }> = [
  { key: 'view', permissions: ['view'] },
  { key: 'explore', permissions: ['view', 'query'] },
  { key: 'manage', permissions: ['view', 'query', 'edit', 'manage', 'share'] },
  { key: 'custom', permissions: [] },
];

const sortedPermissionKey = (permissions: DataSourceGrantPermission[]): string =>
  [...permissions].sort().join('|');

/**
 * The inverse of ACCESS_LEVELS: given a grant's raw permissions, name the
 * level they add up to. Defined beside ACCESS_LEVELS so both directions stay
 * in sync — order-insensitive, since a grant's permissions array carries no
 * guaranteed order.
 */
export const accessLevelFor = (permissions: DataSourceGrantPermission[]): AccessLevelKey => {
  const target = sortedPermissionKey(permissions);
  return (
    ACCESS_LEVELS.find((level) => level.key !== 'custom' && sortedPermissionKey(level.permissions) === target)
      ?.key ?? 'custom'
  );
};

export const buildGrantRequests = (
  selected: string[],
  permissions: DataSourceGrantPermission[],
  rowAccess: RowAccessValue,
  columnAccess?: ColumnAccessValue
): DataSourceAccessGrantRequest[] => {
  // Row access is meaningless without query; persist null rather than block.
  const policyId = requiresRowAccess(permissions) ? toRlsPolicyId(rowAccess) : null;
  const clsPolicyId =
    columnAccess === undefined
      ? undefined
      : requiresColumnAccess(permissions)
        ? toClsPolicyId(columnAccess)
        : null;
  return selected.map((value) => {
    const { type, id } = decodeGranteeValue(value);
    return {
      grantee_type: type,
      grantee_id: id,
      permissions,
      rls_policy_id: policyId,
      ...(columnAccess === undefined ? {} : { cls_policy_id: clsPolicyId }),
    };
  });
};

export const summarizeGrantResults = (
  results: PromiseSettledResult<unknown>[],
  labels: string[]
): { succeeded: string[]; failed: string[] } => {
  const succeeded: string[] = [];
  const failed: string[] = [];
  results.forEach((result, index) => {
    (result.status === 'fulfilled' ? succeeded : failed).push(labels[index]);
  });
  return { succeeded, failed };
};

const { Text } = Typography;

const GROUP_ORDER: SupportedGranteeType[] = ['project', 'user'];

type GranteeSelectOption = {
  value: string;
  label: string;
  secondary?: string;
};

export const GrantShareBar: React.FC<{
  dataSourceId: string;
  organizationId: string | null;
  policies: DataSourceRLSPolicy[];
  columnPolicies?: DataSourceCLSPolicy[];
}> = ({ dataSourceId, organizationId, policies, columnPolicies = [] }) => {
  const t = useTranslations('data_source_detail');
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<AccessLevelKey>('explore');
  const [rowAccess, setRowAccess] = useState<RowAccessValue>(ROW_ACCESS_UNSET);
  const [columnAccess, setColumnAccess] = useState<ColumnAccessValue>(COLUMN_ACCESS_UNSET);
  const { optionsByType, flatOptions } = useGranteeDirectory({ organizationId, enabled: true });
  const upsertGrant = useUpsertDataSourceAccessGrant();

  const permissions = ACCESS_LEVELS.find((item) => item.key === level)?.permissions ?? ['view'];
  const needsRowAccess = requiresRowAccess(permissions);
  const needsColumnAccess = requiresColumnAccess(permissions);
  const blocked =
    (needsRowAccess && rowAccess === ROW_ACCESS_UNSET) ||
    (needsColumnAccess && columnAccess === COLUMN_ACCESS_UNSET);

  const groupedOptions: Array<{ label: string; options: GranteeSelectOption[] }> = useMemo(
    () =>
      GROUP_ORDER.map((type) => ({
        label: t(`share_group_${type}`),
        options: optionsByType[type].map((option) => ({
          value: encodeGranteeValue(option.type, option.value),
          label: option.label,
          secondary: option.secondary,
        })),
      })).filter((group) => group.options.length > 0),
    [optionsByType, t]
  );

  const labelFor = (value: string) =>
    flatOptions.find((option) => encodeGranteeValue(option.type, option.value) === value)?.label ?? value;

  const handleGrant = async () => {
    if (!selected.length || blocked) return;
    const requests = buildGrantRequests(selected, permissions, rowAccess, columnAccess);
    const results = await Promise.allSettled(
      requests.map((data) => upsertGrant.mutateAsync({ id: dataSourceId, data }))
    );
    const { succeeded, failed } = summarizeGrantResults(results, selected.map(labelFor));

    if (succeeded.length) message.success(t('data_source_access_grant_saved'));
    if (failed.length) message.error(t('grant_partial_failure', { names: failed.join(', ') }));

    // Keep the failures selected so they can be retried; clear what succeeded.
    setSelected(failed.length ? selected.filter((value) => failed.includes(labelFor(value))) : []);
    setRowAccess(ROW_ACCESS_UNSET);
    setColumnAccess(COLUMN_ACCESS_UNSET);
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Space wrap align="start" style={{ width: '100%' }}>
        <Select
          mode="multiple"
          allowClear
          virtual
          listHeight={288}
          maxTagCount="responsive"
          value={selected}
          onChange={setSelected}
          placeholder={t('share_placeholder')}
          style={{ minWidth: 360 }}
          optionFilterProp="label"
          options={groupedOptions}
          optionRender={(option) => {
            // antd types `option.data` as the group for grouped options (it has no
            // overlap with the leaf shape, hence the `unknown` hop), but it passes
            // the leaf at runtime. Narrow to the leaf we actually build.
            const data = option.data as unknown as GranteeSelectOption;
            return data.secondary ? (
              <Space direction="vertical" size={0}>
                <span>{data.label}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.secondary}
                </Text>
              </Space>
            ) : (
              data.label
            );
          }}
        />
        <Select<AccessLevelKey>
          value={level}
          onChange={(next) => {
            setLevel(next);
            setRowAccess(ROW_ACCESS_UNSET);
            setColumnAccess(COLUMN_ACCESS_UNSET);
          }}
          style={{ minWidth: 180 }}
          options={ACCESS_LEVELS.filter((item) => item.key !== 'custom').map((item) => ({
            value: item.key,
            label: t(`data_source_access_level_${item.key}`),
          }))}
        />
        {needsRowAccess ? (
          <RowAccessSelect value={rowAccess} onChange={setRowAccess} policies={policies} />
        ) : null}
        {needsColumnAccess ? (
          <ColumnAccessSelect
            value={columnAccess}
            onChange={setColumnAccess}
            policies={columnPolicies}
          />
        ) : null}
        <Button
          type="primary"
          icon={<UserAddOutlined />}
          disabled={!selected.length || blocked}
          loading={upsertGrant.isPending}
          onClick={handleGrant}
        >
          {t('share_submit')}
        </Button>
      </Space>
    </Card>
  );
};

export default GrantShareBar;
