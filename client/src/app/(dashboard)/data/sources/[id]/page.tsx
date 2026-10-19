'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import nextDynamic from 'next/dynamic';
import { Button, Empty, Space, Tabs, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/utils/api';
import { useDataSource, useDataSourceAccessGrants } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import DataSourceOverviewTab from './_components/DataSourceOverviewTab';
import DataSourceSchemaTab from './_components/DataSourceSchemaTab';
import DataSourceAccessTab from './_components/DataSourceAccessTab';
import { isModelEligibleDataSource } from '@/components/data/modelEligible';
import BypassBanner from './_components/BypassBanner';
import { LakehouseComputeSourceNotice } from '@/components/data/LakehouseComputeSourceNotice';
import styles from './DataSourceDetailPage.module.css';
import {
  parseAccessSubParam,
  parseSemanticSectionParam,
  parseTabParam,
  type AccessSubTab,
  type SemanticLayerSection,
} from './_components/tabParam';

const SemanticStudio = isEnterpriseEdition
  ? nextDynamic(() => import('@/ee').then((m) => m.SemanticStudio), { ssr: false })
  : null;

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
  const modelEligible = isModelEligibleDataSource(dataSource?.type);
  // Surfaced on Overview too — a bypass is a source-wide condition, not a tab-local one.
  const { grants } = useDataSourceAccessGrants(dataSourceId, isEnterpriseEdition);

  const tabRaw = searchParams?.get('tab') ?? null;
  const activeTab = parseTabParam(tabRaw);
  const accessSub = parseAccessSubParam(tabRaw, searchParams?.get('access') ?? null);
  const semanticSection = parseSemanticSectionParam(searchParams?.get('section') ?? null);

  const handleTabChange = (key: string) => {
    const params = new URLSearchParams({ tab: key });
    if (key === 'semantic' && semanticSection) {
      params.set('section', semanticSection);
    }
    if (key === 'access') {
      params.set('access', accessSub);
    }
    router.replace(`/data/sources/${dataSourceId}?${params.toString()}`, { scroll: false });
  };

  const handleAccessSubChange = (sub: AccessSubTab) => {
    const params = new URLSearchParams({ tab: 'access', access: sub });
    router.replace(`/data/sources/${dataSourceId}?${params.toString()}`, { scroll: false });
  };

  const handleSemanticSectionChange = (section: SemanticLayerSection) => {
    const params = new URLSearchParams({ tab: 'semantic', section });
    router.replace(`/data/sources/${dataSourceId}?${params.toString()}`, { scroll: false });
  };

  if (!isLoading && (error || !dataSource)) {
    return (
      <DataSourceDetailFrame>
        <div className={styles.emptyState}>
          <Empty
            description={
              // A 403 is "you can't see it", not "it's gone" — say which
              error instanceof ApiError && error.status === 403 ? t('no_access') : t('not_found')
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
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
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => router.push('/data')}>
              {t('back_to_data')}
            </Button>
          </Space>
        </div>
        {activeTab !== 'semantic' ? (
          <Text type="secondary" className={styles.description}>
            {dataSource?.description || (dataSource?.type ? t(`overview_type_${dataSource.type}` as never) : '')}
          </Text>
        ) : null}
      </header>
      <div className={styles.body}>
        <Tabs
          className={styles.tabs}
          destroyInactiveTabPane={false}
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            {
              key: 'overview',
              label: t('tab_overview'),
              children: (
                <div className={styles.tabPanel}>
                  <DataSourceOverviewTab
                    dataSource={dataSource ?? null}
                    banner={
                      <>
                        <BypassBanner grants={grants} onOpenAccess={() => handleTabChange('access')} />
                        <LakehouseComputeSourceNotice
                          dataSource={dataSource ?? null}
                          tableCount={
                            Array.isArray((dataSource?.schema as { tables?: unknown[] } | null)?.tables)
                              ? (dataSource!.schema as { tables: unknown[] }).tables.length
                              : 0
                          }
                        />
                      </>
                    }
                  />
                </div>
              ),
            },
            {
              key: 'schema',
              label: t('tab_schema'),
              children: (
                <div className={styles.tabPanel}>
                  <DataSourceSchemaTab dataSourceId={dataSourceId} />
                </div>
              ),
            },
            ...(isEnterpriseEdition && SemanticStudio && modelEligible
              ? [
                  {
                    key: 'semantic',
                    label: t('tab_semantic'),
                    children: (
                      <div className={styles.tabPanel}>
                        <SemanticStudio
                          dataSourceId={dataSourceId}
                          dataSourceName={dataSource?.name}
                          embedded
                          initialSection={semanticSection}
                          onStudioSectionChange={handleSemanticSectionChange}
                          onRequestSchemaTab={() =>
                            router.replace(`/data/sources/${dataSourceId}?tab=schema`, { scroll: false })
                          }
                        />
                      </div>
                    ),
                  },
                ]
              : []),
            {
              key: 'access',
              label: t('tab_access'),
              children: (
                <div className={styles.tabPanel}>
                  <DataSourceAccessTab
                    dataSourceId={dataSourceId}
                    active={activeTab === 'access'}
                    subTab={accessSub}
                    onSubTabChange={handleAccessSubChange}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </DataSourceDetailFrame>
  );
}
