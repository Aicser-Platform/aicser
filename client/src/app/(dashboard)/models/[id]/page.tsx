'use client';

import dynamic from 'next/dynamic';
import { isEnterpriseEdition } from '@/utils/appPaths';

const EEModelDetailPage = dynamic(() => import('@/ee').then((m) => ({ default: m.ModelDetailPage })), { ssr: false });

export default function ModelDetailRoute() {
  // Community has no models; the list page explains the upgrade.
  if (!isEnterpriseEdition()) {
    if (typeof window !== 'undefined') window.location.replace('/models');
    return null;
  }
  return <EEModelDetailPage />;
}
