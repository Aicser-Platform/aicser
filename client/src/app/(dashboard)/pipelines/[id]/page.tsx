'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { NodeIndexOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEPipelineBuilderPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.PipelineBuilderPage })),
  { ssr: false }
);

function PipelineBuilderCEFallback() {
  const t = useTranslations('data_platform');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 24 }}>
      <Result
        icon={<NodeIndexOutlined style={{ color: 'var(--ant-color-primary)' }} />}
        title={t('upgrade_title')}
        subTitle={t('pipeline_upgrade_desc')}
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
  );
}

export default function PipelineBuilderPage() {
  if (!isEE) return <PipelineBuilderCEFallback />;
  return <EEPipelineBuilderPage />;
}
