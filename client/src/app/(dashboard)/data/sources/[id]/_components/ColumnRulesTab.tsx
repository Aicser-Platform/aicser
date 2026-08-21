'use client';

import React from 'react';
import { Button, Empty, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ScanOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant, DataSourceCLSPolicy } from '@/api/dataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import {
  useDataSourceAccessGrants,
  useDataSourceCLSPolicies,
  useDeleteDataSourceCLSPolicy,
  useSuggestDataSourceCLSPolicy,
} from '@/hooks/useDataSources';
import { CLS_DRAFT_SESSION_PREFIX } from './policy/columnPolicyForm';

const { Text } = Typography;

export const countGrantsUsingColumnPolicy = (grants: DataSourceAccessGrant[], policyId: string): number =>
  grants.filter((grant) => grant.cls_policy_id === policyId).length;

const describeRule = (policy: DataSourceCLSPolicy, t: ReturnType<typeof useTranslations>) =>
  policy.rules.map((rule) => {
    const qualified = `${rule.table_name}.${rule.column_name}`;
    if (rule.action === 'deny') {
      return (
        <Tag key={rule.id} color="red">
          {t('column_rule_summary_deny', { column: qualified })}
        </Tag>
      );
    }
    return (
      <Tag key={rule.id} color="blue">
        {t('column_rule_summary_mask', {
          column: qualified,
          strategy: t(`column_rule_strategy_${rule.mask_strategy ?? 'fixed'}`),
        })}
      </Tag>
    );
  });

export const ColumnRulesTab: React.FC<{ dataSourceId: string; active: boolean }> = ({ dataSourceId, active }) => {
  const t = useTranslations('data_source_detail');
  const router = useRouter();
  const { policies, isLoading } = useDataSourceCLSPolicies(dataSourceId, active);
  const { grants } = useDataSourceAccessGrants(dataSourceId, active);
  const deletePolicy = useDeleteDataSourceCLSPolicy();
  const suggestPolicy = useSuggestDataSourceCLSPolicy();

  if (!isEnterpriseEdition) {
    return <Empty description={t('data_source_access_ee_only')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const handleSuggest = async () => {
    try {
      const draft = await suggestPolicy.mutateAsync({ id: dataSourceId });
      if (!draft.rules.length) {
        message.info(t('column_policy_suggest_empty'));
        return;
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          `${CLS_DRAFT_SESSION_PREFIX}${dataSourceId}`,
          JSON.stringify({ rules: draft.rules })
        );
      }
      router.push(`/data/sources/${dataSourceId}/column-rules/new`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('column_policy_suggest_failed'));
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => router.push(`/data/sources/${dataSourceId}/column-rules/new`)}
        >
          {t('column_policy_new')}
        </Button>
        <Button icon={<ScanOutlined />} loading={suggestPolicy.isPending} onClick={handleSuggest}>
          {t('column_policy_scan')}
        </Button>
      </Space>

      <Table<DataSourceCLSPolicy>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={policies}
        pagination={false}
        columns={[
          {
            title: t('data_source_rls_policy_name'),
            key: 'name',
            render: (_, policy) => (
              <Space direction="vertical" size={4}>
                <Space size={4}>
                  <Text strong>{policy.name}</Text>
                  <Tag color={policy.enabled ? 'green' : 'default'}>{t('policy_active')}</Tag>
                </Space>
                <Space size={[4, 4]} wrap>
                  {describeRule(policy, t)}
                </Space>
              </Space>
            ),
          },
          {
            title: t('data_source_access_grants_tab'),
            key: 'usage',
            width: 160,
            render: (_, policy) => t('policy_used_by', { count: countGrantsUsingColumnPolicy(grants, policy.id) }),
          },
          {
            key: 'actions',
            width: 100,
            render: (_, policy) => (
              <Space>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => router.push(`/data/sources/${dataSourceId}/column-rules/${policy.id}`)}
                />
                <Popconfirm
                  title={t('column_policy_delete_confirm', {
                    count: countGrantsUsingColumnPolicy(grants, policy.id),
                  })}
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    try {
                      await deletePolicy.mutateAsync({ id: dataSourceId, policyId: policy.id });
                      message.success(t('column_policy_deleted'));
                    } catch (error) {
                      message.error(error instanceof Error ? error.message : t('column_policy_delete_failed'));
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
    </>
  );
};

export default ColumnRulesTab;
