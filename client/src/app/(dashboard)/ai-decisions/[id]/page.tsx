'use client';

import dynamic from 'next/dynamic';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEDecisionDetailPage = dynamic(() => import('@/ee-lazy/DecisionDetailPage').then((m) => ({ default: m.DecisionDetailPage })), { ssr: false, loading: PageLoading });

export default function DecisionDetailRoute() {
  // Community has no AI Decisions; the list page explains the upgrade.
  if (!isEnterpriseEdition()) {
    if (typeof window !== 'undefined') window.location.replace('/ai-decisions');
    return null;
  }
  return <EEDecisionDetailPage />;
}
