'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ExperimentOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEModelsPage = dynamic(() => import('@/ee').then((m) => ({ default: m.ModelsPage })), { ssr: false });

function ModelsCEFallback() {
  const t = useTranslations('models');
  return (
    <DashboardPageShell maxWidth={900}>
      <DashboardPageHeader icon={<ExperimentOutlined />} title={t('title')} />
      <Result
        icon={<ExperimentOutlined style={{ color: 'var(--ant-color-primary)' }} />}
        title={t('ce_title')}
        subTitle={t('ce_desc')}
        extra={
          <Button type="primary" icon={<RocketOutlined />} onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}>
            {t('ce_cta')}
          </Button>
        }
      />
    </DashboardPageShell>
  );
}

export default function ModelsRoute() {
  return isEnterpriseEdition() ? <EEModelsPage /> : <ModelsCEFallback />;
}
