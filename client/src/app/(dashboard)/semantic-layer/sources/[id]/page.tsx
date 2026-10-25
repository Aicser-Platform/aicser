'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import nextDynamic from 'next/dynamic';
import { Button, Select, Space, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import { useDataSource, useDataSources } from '@/hooks/useDataSources';
import { isModelEligibleDataSource } from '@/components/data/modelEligible';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import {
  parseSemanticSectionParam,
  semanticLayerStudioHref,
  type SemanticLayerSection,
} from '@/app/(dashboard)/data/sources/[id]/_components/tabParam';

const SemanticStudio = isEnterpriseEdition
  ? nextDynamic(() => import('@/ee').then((m) => m.SemanticStudio), { ssr: false })
  : null;

const { Text } = Typography;

export default function SemanticLayerSourcePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('semantic_studio');
  const dataSourceId = String(params?.id || '');
  const { dataSource, isLoading } = useDataSource(dataSourceId);
  // Switch model in place, like picking a source in the SQL editor or Ask: each model belongs to
  // one connection (its SQL runs on that engine), so switching opens that connection's model.
  const { dataSources } = useDataSources();
  const modelSources = (dataSources ?? []).filter((ds) => isModelEligibleDataSource(ds.type));

  const sectionParam = parseSemanticSectionParam(searchParams?.get('section') ?? null);

  const handleSectionChange = (section: SemanticLayerSection) => {
    router.replace(semanticLayerStudioHref(dataSourceId, section), { scroll: false });
  };

  if (!isEnterpriseEdition || !SemanticStudio) {
    return (
      <DashboardPageShell>
        <DashboardPageHeader title={t('page_title')} description={t('page_subtitle')} />
        <Text type="secondary">{t('ee_only')}</Text>
      </DashboardPageShell>
    );
  }

  if (isLoading && !dataSource) {
    return (
      <DashboardPageShell>
        <AppLoadingIndicator variant="full" />
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell fillHeight>
      <div className="page-body">
        <SemanticStudio
          dataSourceId={dataSourceId}
          dataSourceName={dataSource?.name}
          embedded={false}
          initialSection={sectionParam}
          onStudioSectionChange={handleSectionChange}
          headerStart={
            <Space size={4}>
              <Tooltip title={t('back_to_hub')}>
                <Button type="text" icon={<ArrowLeftOutlined />} aria-label={t('back_to_hub')} onClick={() => router.push('/semantic-layer')} />
              </Tooltip>
              <Select
                showSearch
                variant="borderless"
                optionFilterProp="label"
                value={dataSourceId}
                aria-label={t('switch_model')}
                className="semantic-model-switcher"
                popupMatchSelectWidth={320}
                onChange={(id) => router.push(semanticLayerStudioHref(String(id), sectionParam ?? undefined))}
                options={[
                  ...(modelSources.some((ds) => String(ds.id) === dataSourceId) || !dataSource
                    ? []
                    : [{ value: dataSourceId, label: dataSource.name }]),
                  ...modelSources.map((ds) => ({ value: String(ds.id), label: ds.name })),
                ]}
              />
            </Space>
          }
          headerEnd={
            <Button icon={<DatabaseOutlined />} onClick={() => router.push(`/data/sources/${dataSourceId}`)}>
              {t('open_data_source')}
            </Button>
          }
        />
      </div>
    </DashboardPageShell>
  );
}
