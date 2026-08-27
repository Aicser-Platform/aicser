'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { NarrowViewportNotice } from '@/components/layout/NarrowViewportNotice';

const ChartDesignerStudio = dynamic(() => import('./components/ChartDesignerStudio'), {
  ssr: false,
});

export default function ChartDesignerPageClient() {
  const t = useTranslations('common');
  return (
    <DashboardPageShell fullBleed>
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <NarrowViewportNotice message={t('desktop_recommended')} storageKey="chart-designer" />
        <div style={{ flex: 1, minHeight: 0 }}>
          <ChartDesignerStudio />
        </div>
      </div>
    </DashboardPageShell>
  );
}
