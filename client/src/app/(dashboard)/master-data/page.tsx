'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ClusterOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { isEnterpriseEdition } from '@/utils/appPaths';

const isEE = isEnterpriseEdition();

const EEMasterDataPage = dynamic(() => import('@/ee').then((m) => ({ default: m.MasterDataPage })), { ssr: false });

export default function MasterDataRoute() {
  const t = useTranslations('master_data');
  if (isEE) return <EEMasterDataPage />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 24 }}>
      <Result
        icon={<ClusterOutlined style={{ color: 'var(--ant-color-primary)' }} />}
        title={t('title')}
        subTitle={t('upgrade')}
        extra={
          <Button type="primary" icon={<RocketOutlined />} onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}>
            {t('view_plans')}
          </Button>
        }
      />
    </div>
  );
}
