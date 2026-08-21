'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Button, Empty, Tabs, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDataSource, useDataSourceAccessGrants } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import DataSourceOverviewTab from './_components/DataSourceOverviewTab';
import DataSourceSchemaTab from './_components/DataSourceSchemaTab';
import DataSourcePermissionsTab from './_components/DataSourcePermissionsTab';
import RowFiltersTab from './_components/RowFiltersTab';
import ColumnRulesTab from './_components/ColumnRulesTab';
import BypassBanner from './_components/BypassBanner';
import styles from './DataSourceDetailPage.module.css';
import { parseTabParam } from './_components/tabParam';

const { Text, Title } = Typography;

const DataSourceDetailFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={styles.root}>
    <div className={styles.scroller}>
      <div className={styles.content}>{children}</div>
    </div>
  </div>
);

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
      <DataSourceDetailFrame>
        <div className={styles.emptyState}>
          <Empty description={t('not_found')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/data')}>
              {t('back_to_data')}
            </Button>
          </Empty>
        </div>
      </DataSourceDetailFrame>
    );
  }

  return (
    <DataSourceDetailFrame>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <Title level={2} className={styles.title}>
            {dataSource?.name || dataSourceId}
          </Title>
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => router.push('/data')}>
            {t('back_to_data')}
          </Button>
        </div>
        <Text type="secondary" className={styles.description}>
          {[dataSource?.type, dataSource?.connection_status].filter(Boolean).join(' · ')}
        </Text>
      </header>
      <div className={styles.body}>
        <Tabs
          className={styles.tabs}
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
            {
              key: 'column-rules',
              label: t('tab_column_rules'),
              children: <ColumnRulesTab dataSourceId={dataSourceId} active={activeTab === 'column-rules'} />,
            },
          ]}
        />
      </div>
    </DataSourceDetailFrame>
  );
}
