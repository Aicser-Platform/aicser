'use client';

import React from 'react';
import { Card, Descriptions, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type { DataSource } from '@/stores/useDataSourceStore';

const formatBytes = (size?: number): string => {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export const DataSourceOverviewTab: React.FC<{
  dataSource: DataSource | null;
  banner?: React.ReactNode;
}> = ({ dataSource, banner }) => {
  const t = useTranslations('data_source_detail');

  return (
    <>
      {banner}
      <Card size="small" title={t('tab_overview')}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label={t('data_source_rls_policy_name')}>
            {dataSource?.name ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('data_source_access_grantee_type')}>
            <Tag>{(dataSource?.type ?? '—').toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={dataSource?.connection_status === 'connected' ? 'green' : 'default'}>
              {(dataSource?.connection_status ?? 'unknown').toUpperCase()}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Rows">{dataSource?.row_count ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Size">{formatBytes(dataSource?.size)}</Descriptions.Item>
          <Descriptions.Item label="Updated">{dataSource?.updated_at ?? '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );
};

export default DataSourceOverviewTab;
