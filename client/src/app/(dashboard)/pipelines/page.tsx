'use client';

import dynamic from 'next/dynamic';
import { Route as RouteIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/aicser-ui/button';
import { PageBody } from '@/components/aicser-ui/page';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';
import { isEnterpriseEdition } from '@/utils/appPaths';

const isEE = isEnterpriseEdition();

const EEPipelinesPage = dynamic(() => import('@/ee-lazy/PipelinesPage').then((m) => ({ default: m.PipelinesPage })), {
  ssr: false,
  loading: PageLoading,
});

/** Community edition: pipelines are part of the Enterprise data platform. */
function PipelinesCEFallback() {
  const t = useTranslations('data_platform');
  return (
    <PageBody>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card p-10 text-center">
        <RouteIcon className="size-8 text-primary-hover dark:text-primary" aria-hidden />
        <h1 className="m-0 text-base font-semibold">{t('upgrade_title')}</h1>
        <p className="m-0 max-w-md text-sm text-muted-foreground">{t('pipeline_upgrade_desc')}</p>
        <Button onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}>{t('view_plans')}</Button>
      </div>
    </PageBody>
  );
}

export default function PipelinesPage() {
  if (!isEE) return <PipelinesCEFallback />;
  return <EEPipelinesPage />;
}
