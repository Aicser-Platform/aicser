'use client';

import React, { useMemo, useState } from 'react';
import { Button, Card, Select, Space, message } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type {
  DataSourceAccessGrantRequest,
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

export type AccessLevelKey = 'view' | 'explore' | 'manage' | 'custom';

export const ACCESS_LEVELS: Array<{ key: AccessLevelKey; permissions: DataSourceGrantPermission[] }> = [
  { key: 'view', permissions: ['view'] },
  { key: 'explore', permissions: ['view', 'query'] },
  { key: 'manage', permissions: ['view', 'query', 'edit', 'manage', 'share'] },
  { key: 'custom', permissions: [] },
];

export const buildGrantRequests = (
  selected: string[],
  permissions: DataSourceGrantPermission[],
  rowAccess: RowAccessValue
): DataSourceAccessGrantRequest[] => {
  // Row access is meaningless without query; persist null rather than block.
  const policyId = requiresRowAccess(permissions) ? toRlsPolicyId(rowAccess) : null;
  return selected.map((value) => {
    const { type, id } = decodeGranteeValue(value);
    return { grantee_type: type, grantee_id: id, permissions, rls_policy_id: policyId };
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

const GROUP_ORDER: SupportedGranteeType[] = ['project', 'user', 'org_role', 'project_role'];

export const GrantShareBar: React.FC<{
  dataSourceId: string;
  organizationId: string | null;
  policies: DataSourceRLSPolicy[];
}> = ({ dataSourceId, organizationId, policies }) => {
  const t = useTranslations('data_source_detail');
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<AccessLevelKey>('explore');
  const [rowAccess, setRowAccess] = useState<RowAccessValue>(ROW_ACCESS_UNSET);
  const { optionsByType, flatOptions } = useGranteeDirectory({ organizationId, enabled: true });
  const upsertGrant = useUpsertDataSourceAccessGrant();

  const permissions = ACCESS_LEVELS.find((item) => item.key === level)?.permissions ?? ['view'];
  const needsRowAccess = requiresRowAccess(permissions);
  const blocked = needsRowAccess && rowAccess === ROW_ACCESS_UNSET;

  const groupedOptions = useMemo(
    () =>
      GROUP_ORDER.map((type) => ({
        label: t(`share_group_${type}`),
        options: optionsByType[type].map((option) => ({
          value: encodeGranteeValue(option.type, option.value),
          label: option.label,
        })),
      })).filter((group) => group.options.length > 0),
    [optionsByType, t]
  );

  const labelFor = (value: string) =>
    flatOptions.find((option) => encodeGranteeValue(option.type, option.value) === value)?.label ?? value;

  const handleGrant = async () => {
    if (!selected.length || blocked) return;
    const requests = buildGrantRequests(selected, permissions, rowAccess);
    const results = await Promise.allSettled(
      requests.map((data) => upsertGrant.mutateAsync({ id: dataSourceId, data }))
    );
    const { succeeded, failed } = summarizeGrantResults(results, selected.map(labelFor));

    if (succeeded.length) message.success(t('data_source_access_grant_saved'));
    if (failed.length) message.error(t('grant_partial_failure', { names: failed.join(', ') }));

    // Keep the failures selected so they can be retried; clear what succeeded.
    setSelected(failed.length ? selected.filter((value) => failed.includes(labelFor(value))) : []);
    setRowAccess(ROW_ACCESS_UNSET);
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Space wrap align="start" style={{ width: '100%' }}>
        <Select
          mode="multiple"
          allowClear
          value={selected}
          onChange={setSelected}
          placeholder={t('share_placeholder')}
          style={{ minWidth: 360 }}
          optionFilterProp="label"
          options={groupedOptions}
        />
        <Select<AccessLevelKey>
          value={level}
          onChange={(next) => {
            setLevel(next);
            setRowAccess(ROW_ACCESS_UNSET);
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
