'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Button, Empty, Tabs } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useDataSource, useDataSourceAccessGrants } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import DataSourceOverviewTab from './_components/DataSourceOverviewTab';
import DataSourceSchemaTab from './_components/DataSourceSchemaTab';
import DataSourcePermissionsTab from './_components/DataSourcePermissionsTab';
import RowFiltersTab from './_components/RowFiltersTab';
import BypassBanner from './_components/BypassBanner';

export type DetailTabKey = 'overview' | 'schema' | 'permissions' | 'row-filters';

const TAB_KEYS: DetailTabKey[] = ['overview', 'schema', 'permissions', 'row-filters'];

export function parseTabParam(raw: string | null): DetailTabKey {
  return TAB_KEYS.includes(raw as DetailTabKey) ? (raw as DetailTabKey) : 'overview';
}

export default function DataSourceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('data_source_detail');
  const dataSourceId = String(params?.id || '');
  const { dataSource, isLoading, error } = useDataSource(dataSourceId);
  // Surfaced on Overview too — a bypass is a source-wide condition, not a tab-local one.
  const { grants } = useDataSourceAccessGrants(dataSourceId, isEnterpriseEdition);

  const activeTab = parseTabParam(searchParams?.get('tab') ?? null);

  const handleTabChange = (key: string) => {
    router.replace(`/data/sources/${dataSourceId}?tab=${key}`, { scroll: false });
  };

  if (!isLoading && (error || !dataSource)) {
    return (
      <DashboardPageShell maxWidth={1400}>
        <Empty description={t('not_found')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/data')}>
            {t('back_to_data')}
          </Button>
        </Empty>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell maxWidth={1400}>
      <DashboardPageHeader
        title={dataSource?.name || dataSourceId}
        description={[dataSource?.type, dataSource?.connection_status].filter(Boolean).join(' · ')}
        extra={
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => router.push('/data')}>
            {t('back_to_data')}
          </Button>
        }
      />
      <div className="page-body">
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            {
              key: 'overview',
              label: t('tab_overview'),
              children: (
                <DataSourceOverviewTab
                  dataSource={dataSource ?? null}
                  banner={<BypassBanner grants={grants} />}
                />
              ),
            },
            {
              key: 'schema',
              label: t('tab_schema'),
              children: <DataSourceSchemaTab dataSourceId={dataSourceId} />,
            },
            {
              key: 'permissions',
              label: t('tab_permissions'),
              children: (
                <DataSourcePermissionsTab dataSourceId={dataSourceId} active={activeTab === 'permissions'} />
              ),
            },
            {
              key: 'row-filters',
              label: t('tab_row_filters'),
              children: <RowFiltersTab dataSourceId={dataSourceId} active={activeTab === 'row-filters'} />,
            },
          ]}
        />
      </div>
    </DashboardPageShell>
  );
}
