'use client';

import dynamic from 'next/dynamic';
import { DatabaseOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { useTranslations } from 'next-intl';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEOnboardingPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.OnboardingPage })),
  { ssr: false }
);

function OnboardingCEFallback() {
  const t = useTranslations();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 24 }}>
      <Result
        icon={<DatabaseOutlined style={{ color: 'var(--ant-color-primary)' }} />}
        title={t('data_platform.upgrade_title')}
        subTitle={t('onboarding.upgrade_desc')}
        extra={
          <Button
            type="primary"
            aria-label={t('data_platform.view_plans')}
            icon={<RocketOutlined />}
            onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}
          >
            {t('data_platform.view_plans')}
          </Button>
        }
      />
    </div>
  );
}

export default function OnboardingPage() {
  if (!isEE) return <OnboardingCEFallback />;
  return <EEOnboardingPage />;
}
