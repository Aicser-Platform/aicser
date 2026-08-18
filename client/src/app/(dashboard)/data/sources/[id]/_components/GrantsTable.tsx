'use client';

import React from 'react';
import { Button, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';

const { Text } = Typography;
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant, DataSourceGrantPermission, DataSourceRLSPolicy } from '@/api/dataSources';
import {
  useRevokeDataSourceAccessGrant,
  useUpsertDataSourceAccessGrant,
} from '@/hooks/useDataSources';
import { ACCESS_LEVELS, type AccessLevelKey } from './GrantShareBar';
import AccessSentence from './AccessSentence';
import { grantEffect, type GrantEffectKind } from './grantEffect';
import RowAccessSelect, {
  fromRlsPolicyId,
  requiresRowAccess,
  toRlsPolicyId,
  type RowAccessValue,
} from './RowAccessSelect';

const samePermissions = (a: DataSourceGrantPermission[], b: DataSourceGrantPermission[]) =>
  [...a].sort().join('|') === [...b].sort().join('|');

export const accessLevelForPermissions = (
  permissions: DataSourceGrantPermission[]
): AccessLevelKey =>
  ACCESS_LEVELS.find((level) => level.key !== 'custom' && samePermissions(level.permissions, permissions))
    ?.key ?? 'custom';

const EFFECT_TONE: Record<GrantEffectKind, { color: string; key: string }> = {
  metadata_only: { color: 'default', key: 'effect_metadata_only' },
  all_rows: { color: 'warning', key: 'effect_all_rows' },
  filtered: { color: 'green', key: 'effect_filtered' },
  denies_all: { color: 'red', key: 'effect_deny_all' },
};

export const GrantsTable: React.FC<{
  dataSourceId: string;
  grants: DataSourceAccessGrant[];
  policies: DataSourceRLSPolicy[];
  loading?: boolean;
  granteeLabel: (grant: DataSourceAccessGrant) => string;
}> = ({ dataSourceId, grants, policies, loading, granteeLabel }) => {
  const t = useTranslations('data_source_detail');
  const upsertGrant = useUpsertDataSourceAccessGrant();
  const revokeGrant = useRevokeDataSourceAccessGrant();

  const save = async (
    grant: DataSourceAccessGrant,
    permissions: DataSourceGrantPermission[],
    rowAccess: RowAccessValue
  ) => {
    try {
      await upsertGrant.mutateAsync({
        id: dataSourceId,
        data: {
          grantee_type: grant.grantee_type,
          grantee_id: grant.grantee_id,
          permissions,
          rls_policy_id: requiresRowAccess(permissions) ? toRlsPolicyId(rowAccess) : null,
        },
      });
      message.success(t('data_source_access_grant_saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('data_source_access_grant_save_failed'));
    }
  };

  return (
    <Table<DataSourceAccessGrant>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={grants}
      pagination={false}
      expandable={{
        expandedRowRender: (grant) => {
          const effect = grantEffect(grant, policies);
          return (
            <Space direction="vertical" size={6} style={{ padding: '4px 0 8px' }}>
              <Space size={8}>
                <Tag color={EFFECT_TONE[effect.kind].color}>{t(EFFECT_TONE[effect.kind].key)}</Tag>
                {effect.policyName ? <Text type="secondary">{effect.policyName}</Text> : null}
              </Space>
              {effect.kind === 'all_rows' ? (
                <Text type="warning" style={{ fontSize: 13 }}>
                  {t('effect_all_rows_detail')}
                </Text>
              ) : null}
              {effect.kind === 'denies_all' ? (
                <Text type="danger" style={{ fontSize: 13 }}>
                  {t('effect_deny_all_detail')}
                </Text>
              ) : null}
              {effect.rules.map((rule) => (
                <AccessSentence key={rule.id} rule={rule} />
              ))}
            </Space>
          );
        },
      }}
      columns={[
        {
          title: t('data_source_access_grantee'),
          key: 'grantee',
          render: (_, grant) => (
            <Space direction="vertical" size={0}>
              <span>{granteeLabel(grant)}</span>
              <Tag>{t(`data_source_access_grantee_${grant.grantee_type}`)}</Tag>
            </Space>
          ),
        },
        {
          title: t('data_source_access_access_level'),
          key: 'level',
          width: 200,
          render: (_, grant) => {
            const level = accessLevelForPermissions(grant.permissions);
            if (level === 'custom') {
              return (
                <Space size={4} wrap>
                  {grant.permissions.map((permission) => (
                    <Tag key={permission}>{t(`data_source_access_permission_${permission}`)}</Tag>
                  ))}
                </Space>
              );
            }
            return (
              <Select<AccessLevelKey>
                value={level}
                style={{ width: '100%' }}
                onChange={(next) => {
                  const permissions = ACCESS_LEVELS.find((item) => item.key === next)?.permissions ?? ['view'];
                  void save(grant, permissions, fromRlsPolicyId(grant.rls_policy_id));
                }}
                options={ACCESS_LEVELS.filter((item) => item.key !== 'custom').map((item) => ({
                  value: item.key,
                  label: t(`data_source_access_level_${item.key}`),
                }))}
              />
            );
          },
        },
        {
          title: t('row_access_label'),
          key: 'rowAccess',
          width: 300,
          render: (_, grant) =>
            requiresRowAccess(grant.permissions) ? (
              <RowAccessSelect
                value={fromRlsPolicyId(grant.rls_policy_id)}
                policies={policies}
                style={{ width: '100%' }}
                onChange={(next) => void save(grant, grant.permissions, next)}
              />
            ) : (
              <Tag>{t('row_access_not_applicable')}</Tag>
            ),
        },
        {
          key: 'actions',
          width: 60,
          render: (_, grant) => (
            <Popconfirm
              title={t('data_source_access_revoke_title')}
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                try {
                  await revokeGrant.mutateAsync({ id: dataSourceId, grantId: grant.id });
                  message.success(t('data_source_access_grant_revoked'));
                } catch (error) {
                  message.error(
                    error instanceof Error ? error.message : t('data_source_access_grant_revoke_failed')
                  );
                }
              }}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ),
        },
      ]}
    />
  );
};

export default GrantsTable;
