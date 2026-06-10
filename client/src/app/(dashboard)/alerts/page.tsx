'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { BellOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEAlertsPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.AlertsPage })),
  { ssr: false }
);

function AlertsCEFallback() {
  const t = useTranslations('alerts');
  return (
    <DashboardPageShell maxWidth={900}>
      <DashboardPageHeader icon={<BellOutlined />} title={t('title')} />
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Result
          icon={<BellOutlined style={{ color: 'var(--ant-color-primary)' }} />}
          title={t('ce_title')}
          subTitle={t('ce_desc')}
          extra={
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}
            >
              {t('ce_cta')}
            </Button>
          }
        />
      </div>
    </DashboardPageShell>
  );
}

export default function AlertsPage() {
  if (!isEE) return <AlertsCEFallback />;
  return <EEAlertsPage />;
}
