'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, Space, Statistic, Table, Tag, Typography } from 'antd';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text } = Typography;

type Row = {
  id: string;
  name: string;
  kind: string;
  row_rules: number;
  masked_columns: number;
  grants: number;
  unfiltered_grants: number;
};

type Overview = { sources: Row[]; totals: { sources: number; unprotected: number; row_rules?: number; masked_columns?: number } };

/** Every connection's access rules in one place; each row links to where the rules are edited. */
export function AccessOverviewTab() {
  const t = useTranslations('governance');
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { data, isLoading } = useQuery({
    queryKey: ['governance', 'overview', projectId ?? null],
    queryFn: () => fetchApi<Overview>(`/api/governance/overview${projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : ''}`),
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Text type="secondary">{t('overview_desc')}</Text>
      <Space size={32} wrap>
        <Statistic title={t('total_sources')} value={data?.totals.sources ?? 0} />
        <Statistic title={t('total_row_rules')} value={data?.totals.row_rules ?? 0} />
        <Statistic title={t('total_masked')} value={data?.totals.masked_columns ?? 0} />
        <Statistic title={t('total_unprotected')} value={data?.totals.unprotected ?? 0} valueStyle={data?.totals.unprotected ? { color: 'var(--ant-color-warning)' } : undefined} />
      </Space>
      {data?.totals.unprotected ? <Alert type="warning" showIcon message={t('unprotected_alert', { count: data.totals.unprotected })} /> : null}
      <Table<Row>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.sources ?? []}
        pagination={false}
        locale={{ emptyText: t('empty') }}
        columns={[
          {
            title: t('col_connection'),
            dataIndex: 'name',
            render: (name: string, r) => (
              <Space direction="vertical" size={0}>
                <Text strong>{name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{r.kind}</Text>
              </Space>
            ),
          },
          { title: t('col_row_rules'), dataIndex: 'row_rules', width: 120 },
          { title: t('col_masked'), dataIndex: 'masked_columns', width: 140 },
          { title: t('col_grants'), dataIndex: 'grants', width: 110 },
          {
            title: t('col_status'),
            key: 'status',
            width: 200,
            render: (_, r) =>
              r.unfiltered_grants && !r.row_rules ? (
                <Tag color="warning">{t('status_all_rows', { count: r.unfiltered_grants })}</Tag>
              ) : r.row_rules || r.masked_columns ? (
                <Tag color="success">{t('status_protected')}</Tag>
              ) : (
                <Tag>{t('status_owner_only')}</Tag>
              ),
          },
          {
            key: 'open',
            width: 120,
            render: (_, r) => (
              <Button size="small" onClick={() => router.push(`/data/sources/${encodeURIComponent(r.id)}?tab=access`)}>
                {t('edit_rules')}
              </Button>
            ),
          },
        ]}
      />
    </Space>
  );
}

export default AccessOverviewTab;
