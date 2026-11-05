'use client';

import dynamic from 'next/dynamic';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEModelDetailPage = dynamic(() => import('@/ee-lazy/ModelDetailPage').then((m) => ({ default: m.ModelDetailPage })), { ssr: false, loading: PageLoading });

export default function ModelDetailRoute() {
  // Community has no models; the list page explains the upgrade.
  if (!isEnterpriseEdition()) {
    if (typeof window !== 'undefined') window.location.replace('/models');
    return null;
  }
  return <EEModelDetailPage />;
}
