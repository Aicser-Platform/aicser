'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import SemanticStudio from '@/ee/components/semantic/SemanticStudio';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';

export default function SemanticStudioPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('semantic_studio');
  const dataSourceId = String(params?.id || '');
  const authenticatedFetch = useAuthenticatedFetch();
  const [name, setName] = React.useState<string>('');

  React.useEffect(() => {
    if (!dataSourceId) return;
    authenticatedFetch(`/api/data/sources/${dataSourceId}`)
      .then((res) => setName(res?.data_source?.name || res?.name || dataSourceId))
      .catch(() => setName(dataSourceId));
  }, [authenticatedFetch, dataSourceId]);

  return (
    <DashboardPageShell maxWidth={1400}>
      <DashboardPageHeader
        title={name || t('page_title')}
        description={t('page_subtitle')}
        extra={
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => router.push('/semantic-layer')}>
            {t('back_to_hub')}
          </Button>
        }
      />
      <div className="page-body">
      <SemanticStudio dataSourceId={dataSourceId} dataSourceName={name} />
      </div>
    </DashboardPageShell>
  );
}
