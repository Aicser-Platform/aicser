'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ApiOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEDataPlatformPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.DataPlatformPage })),
  { ssr: false }
);

function DataPlatformCEFallback() {
  const t = useTranslations('data_platform');
  return (
    <DashboardPageShell maxWidth={900}>
      <DashboardPageHeader icon={<ApiOutlined />} title={t('page_title')} />
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Result
          icon={<ApiOutlined style={{ color: 'var(--ant-color-primary)' }} />}
          title={t('upgrade_title')}
          subTitle={t('upgrade_desc')}
          extra={
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}
            >
              {t('view_plans')}
            </Button>
          }
        />
      </div>
    </DashboardPageShell>
  );
}

export default function DataPlatformPage() {
  if (!isEE) return <DataPlatformCEFallback />;
  return <EEDataPlatformPage />;
}
