'use client';

import dynamic from 'next/dynamic';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEDecisionDetailPage = dynamic(() => import('@/ee').then((m) => ({ default: m.DecisionDetailPage })), { ssr: false });

export default function DecisionDetailRoute() {
  // Community has no AI Decisions; the list page explains the upgrade.
  if (!isEnterpriseEdition()) {
    if (typeof window !== 'undefined') window.location.replace('/ai-decisions');
    return null;
  }
  return <EEDecisionDetailPage />;
}
