'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';

import { isEnterpriseEdition } from '@/utils/appPaths';

const isEE = isEnterpriseEdition();

const EEAIDecisionsPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.AIDecisionsPage })),
  { ssr: false }
);

function AIDecisionsCEFallback() {
  const t = useTranslations('ai_decisions');
  return (
    <DashboardPageShell>
      <DashboardPageHeader icon={<ThunderboltOutlined />} title={t('title')} />
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Result
          icon={<ThunderboltOutlined style={{ color: 'var(--ant-color-primary)' }} />}
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

export default function AIDecisionsPage() {
  if (!isEE) return <AIDecisionsCEFallback />;
  return <EEAIDecisionsPage />;
}
