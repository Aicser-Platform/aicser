'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ClusterOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEWarehousePage = dynamic(() => import('@/ee').then((m) => ({ default: m.WarehousePage })), { ssr: false });

function WarehouseCEFallback() {
  const t = useTranslations('warehouse');
  return (
    <DashboardPageShell maxWidth={900}>
      <DashboardPageHeader icon={<ClusterOutlined />} title={t('title')} />
      <Result
        icon={<ClusterOutlined style={{ color: 'var(--ant-color-primary)' }} />}
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

export default function WarehouseRoute() {
  return isEnterpriseEdition() ? <EEWarehousePage /> : <WarehouseCEFallback />;
}
