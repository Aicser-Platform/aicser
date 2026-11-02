'use client';

import dynamic from 'next/dynamic';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';
import { useTranslations } from 'next-intl';
import { RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';

import { isEnterpriseEdition } from '@/utils/appPaths';

const isEE = isEnterpriseEdition();

const EEAgentPage = dynamic(() => import('@/ee-lazy/AgentPage').then((m) => ({ default: m.AgentPage })), { ssr: false, loading: PageLoading });

function AgentCEFallback() {
  const t = useTranslations('agent');
  return (
    <DashboardPageShell>
      <DashboardPageHeader icon={<RobotOutlined />} title={t('page_title')} />
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Result
          icon={<RobotOutlined style={{ color: 'var(--ant-color-primary)' }} />}
          title={t('ce_title')}
          subTitle={t('ce_desc')}
          extra={
            <Button type="primary" icon={<RocketOutlined />} onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}>
              {t('ce_cta')}
            </Button>
          }
        />
      </div>
    </DashboardPageShell>
  );
}

export default function AgentPage() {
  if (!isEE) return <AgentCEFallback />;
  return <EEAgentPage />;
}
