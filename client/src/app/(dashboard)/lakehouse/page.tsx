'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DatabaseOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { isEnterpriseEdition } from '@/utils/appPaths';

function LakehouseCEFallback() {
  const t = useTranslations('warehouse');
  return (
    <DashboardPageShell className="lakehouse-page">
      <DashboardPageHeader icon={<DatabaseOutlined />} title={t('title')} />
      <Result
        icon={<DatabaseOutlined style={{ color: 'var(--ant-color-primary)' }} />}
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

/** Storage, compute and cost are admin settings now; old /lakehouse links land there.
 * The Gold tables tab moved with it; people browse lake tables in the Catalog. */
function LakehouseRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams?.get('tab');
    const section = tab && tab !== 'overview' ? `&section=${encodeURIComponent(tab)}` : '';
    router.replace(`/settings?tab=lakehouse${section}`);
  }, [router, searchParams]);
  return null;
}

export default function LakehouseRoute() {
  return isEnterpriseEdition() ? (
    <Suspense fallback={null}>
      <LakehouseRedirect />
    </Suspense>
  ) : (
    <LakehouseCEFallback />
  );
}
