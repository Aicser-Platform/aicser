'use client';

import React, { useCallback, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { ClusterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import type { DataSource } from '@/stores/useDataSourceStore';
import { isLakehouseComputeDataSource, lakehouseWarehouseIdFromSource } from '@/utils/lakehouseComputeSource';

export function LakehouseComputeSourceNotice({
  dataSource,
  tableCount,
  onSchemaRefresh,
  variant = 'banner',
}: {
  dataSource: DataSource | null | undefined;
  tableCount?: number;
  onSchemaRefresh?: () => void;
  variant?: 'banner' | 'empty';
}) {
  const t = useTranslations('lakehouse_compute_source');
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  if (!isLakehouseComputeDataSource(dataSource)) return null;

  const empty = (tableCount ?? 0) === 0;
  const warehouseId = lakehouseWarehouseIdFromSource(dataSource);

  const refreshSchema = useCallback(async () => {
    if (!isEnterpriseEdition || !warehouseId) {
      onSchemaRefresh?.();
      return;
    }
    setRefreshing(true);
    try {
      await fetchApi(`/api/warehouse/warehouses/${encodeURIComponent(warehouseId)}/refresh`, { method: 'POST' });
      onSchemaRefresh?.();
    } finally {
      setRefreshing(false);
    }
  }, [onSchemaRefresh, warehouseId]);

  if (variant === 'empty' && !empty) return null;

  return (
    <Alert
      type={empty ? 'warning' : 'info'}
      showIcon
      icon={<ClusterOutlined />}
      style={{ marginBottom: 16 }}
      message={empty ? t('empty_title') : t('info_title')}
      description={
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <span>{empty ? t('empty_desc') : t('info_desc')}</span>
          <Space wrap>
            <Button size="small" onClick={() => router.push('/pipelines')}>{t('open_pipelines')}</Button>
            <Button size="small" onClick={() => router.push('/lakehouse?tab=tables')}>{t('view_gold_tables')}</Button>
            <Button size="small" onClick={() => router.push('/lakehouse?tab=compute')}>{t('manage_compute')}</Button>
            {isEnterpriseEdition && warehouseId ? (
              <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refreshSchema()}>
                {t('sync_schema')}
              </Button>
            ) : null}
          </Space>
        </Space>
      }
    />
  );
}
