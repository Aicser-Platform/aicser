'use client';

import React from 'react';
import { Button, Empty, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant, DataSourceRLSPolicy } from '@/api/dataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import {
  useDataSourceAccessGrants,
  useDataSourceRLSPolicies,
  useDeleteDataSourceRLSPolicy,
} from '@/hooks/useDataSources';
import AccessSentence from './AccessSentence';

const { Text } = Typography;

export const countGrantsUsingPolicy = (grants: DataSourceAccessGrant[], policyId: string): number =>
  grants.filter((grant) => grant.rls_policy_id === policyId).length;

export const RowFiltersTab: React.FC<{ dataSourceId: string; active: boolean }> = ({ dataSourceId, active }) => {
  const t = useTranslations('data_source_detail');
  const router = useRouter();
  const { policies, isLoading } = useDataSourceRLSPolicies(dataSourceId, active);
  const { grants } = useDataSourceAccessGrants(dataSourceId, active);
  const deletePolicy = useDeleteDataSourceRLSPolicy();

  if (!isEnterpriseEdition) {
    return <Empty description={t('data_source_access_ee_only')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => router.push(`/data/sources/${dataSourceId}/row-filters/new`)}
        >
          {t('policy_new')}
        </Button>
      </Space>

      <Table<DataSourceRLSPolicy>
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
              <Space direction="vertical" size={0}>
                <Space size={4}>
                  <Text strong>{policy.name}</Text>
                  <Tag color={policy.enabled ? 'green' : 'default'}>{t('policy_active')}</Tag>
                  {policy.default_deny ? <Tag color="red">{t('data_source_rls_default_deny')}</Tag> : null}
                </Space>
                {policy.rules.map((rule) => (
                  <AccessSentence key={rule.id} rule={rule} />
                ))}
              </Space>
            ),
          },
          {
            title: t('data_source_access_grants_tab'),
            key: 'usage',
            width: 160,
            render: (_, policy) => t('policy_used_by', { count: countGrantsUsingPolicy(grants, policy.id) }),
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
                  onClick={() => router.push(`/data/sources/${dataSourceId}/row-filters/${policy.id}`)}
                />
                <Popconfirm
                  title={t('policy_delete_confirm', { count: countGrantsUsingPolicy(grants, policy.id) })}
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    try {
                      await deletePolicy.mutateAsync({ id: dataSourceId, policyId: policy.id });
                      message.success(t('data_source_rls_policy_deleted'));
                    } catch (error) {
                      message.error(
                        error instanceof Error ? error.message : t('data_source_rls_policy_delete_failed')
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
    </>
  );
};

export default RowFiltersTab;
