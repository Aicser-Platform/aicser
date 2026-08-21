'use client';

import React, { useState } from 'react';
import { Button, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';

const { Text } = Typography;
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type {
  DataSourceAccessGrant,
  DataSourceCLSPolicy,
  DataSourceGrantPermission,
  DataSourceRLSPolicy,
} from '@/api/dataSources';
import {
  useRevokeDataSourceAccessGrant,
  useUpsertDataSourceAccessGrant,
} from '@/hooks/useDataSources';
import { ACCESS_LEVELS, accessLevelFor, type AccessLevelKey } from './GrantShareBar';
import AccessSentence from './AccessSentence';
import { grantEffect, EFFECT_TONE } from './grantEffect';
import EffectiveAccessDrawer from './EffectiveAccessDrawer';
import RowAccessSelect, {
  fromRlsPolicyId,
  requiresRowAccess,
  toRlsPolicyId,
  type RowAccessValue,
} from './RowAccessSelect';
import ColumnAccessSelect, {
  fromClsPolicyId,
  requiresColumnAccess,
  toClsPolicyId,
  type ColumnAccessValue,
} from './ColumnAccessSelect';

export const GrantsTable: React.FC<{
  dataSourceId: string;
  grants: DataSourceAccessGrant[];
  policies: DataSourceRLSPolicy[];
  columnPolicies: DataSourceCLSPolicy[];
  loading?: boolean;
  granteeLabel: (grant: DataSourceAccessGrant) => string;
}> = ({ dataSourceId, grants, policies, columnPolicies, loading, granteeLabel }) => {
  const t = useTranslations('data_source_detail');
  const upsertGrant = useUpsertDataSourceAccessGrant();
  const revokeGrant = useRevokeDataSourceAccessGrant();
  const [inspectedGrant, setInspectedGrant] = useState<DataSourceAccessGrant | null>(null);

  const save = async (
    grant: DataSourceAccessGrant,
    permissions: DataSourceGrantPermission[],
    rowAccess: RowAccessValue,
    columnAccess: ColumnAccessValue
  ) => {
    try {
      await upsertGrant.mutateAsync({
        id: dataSourceId,
        data: {
          grantee_type: grant.grantee_type,
          grantee_id: grant.grantee_id,
          permissions,
          rls_policy_id: requiresRowAccess(permissions) ? toRlsPolicyId(rowAccess) : null,
          cls_policy_id: requiresColumnAccess(permissions) ? toClsPolicyId(columnAccess) : null,
        },
      });
      message.success(t('data_source_access_grant_saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('data_source_access_grant_save_failed'));
    }
  };

  return (
    <>
    <Table<DataSourceAccessGrant>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={grants}
      pagination={false}
      expandable={{
        expandedRowRender: (grant) => {
          const effect = grantEffect(grant, policies);
          const columnPolicy = grant.cls_policy_id
            ? columnPolicies.find((item) => item.id === grant.cls_policy_id)
            : null;
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
              {requiresColumnAccess(grant.permissions) ? (
                <Space size={[4, 4]} wrap>
                  {columnPolicy ? (
                    columnPolicy.rules.map((rule) => (
                      <Tag key={rule.id} color={rule.action === 'deny' ? 'red' : 'blue'}>
                        {rule.action === 'deny'
                          ? t('column_rule_summary_deny', {
                              column: `${rule.table_name}.${rule.column_name}`,
                            })
                          : t('column_rule_summary_mask', {
                              column: `${rule.table_name}.${rule.column_name}`,
                              strategy: t(`column_rule_strategy_${rule.mask_strategy ?? 'fixed'}`),
                            })}
                      </Tag>
                    ))
                  ) : (
                    <Tag color="warning">{t('column_access_all_columns')}</Tag>
                  )}
                </Space>
              ) : null}
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
            const level = accessLevelFor(grant.permissions);
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
                  void save(
                    grant,
                    permissions,
                    fromRlsPolicyId(grant.rls_policy_id),
                    fromClsPolicyId(grant.cls_policy_id)
                  );
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
                onChange={(next) => void save(grant, grant.permissions, next, fromClsPolicyId(grant.cls_policy_id))}
              />
            ) : (
              <Tag>{t('row_access_not_applicable')}</Tag>
            ),
        },
        {
          title: t('column_access_label'),
          key: 'columnAccess',
          width: 300,
          render: (_, grant) =>
            requiresColumnAccess(grant.permissions) ? (
              <ColumnAccessSelect
                value={fromClsPolicyId(grant.cls_policy_id)}
                policies={columnPolicies}
                style={{ width: '100%' }}
                onChange={(next) => void save(grant, grant.permissions, fromRlsPolicyId(grant.rls_policy_id), next)}
              />
            ) : (
              <Tag>{t('column_access_not_applicable')}</Tag>
            ),
        },
        {
          key: 'actions',
          width: 90,
          render: (_, grant) => (
            <Space size={4}>
              <Tooltip title={t('effective_access_view_button')}>
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  aria-label={t('effective_access_view_button')}
                  onClick={() => setInspectedGrant(grant)}
                />
              </Tooltip>
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
            </Space>
          ),
        },
      ]}
    />
    <EffectiveAccessDrawer
      open={Boolean(inspectedGrant)}
      onClose={() => setInspectedGrant(null)}
      dataSourceId={dataSourceId}
      grant={inspectedGrant}
      policies={policies}
      columnPolicies={columnPolicies}
      granteeLabel={inspectedGrant ? granteeLabel(inspectedGrant) : ''}
    />
    </>
  );
};

export default GrantsTable;
