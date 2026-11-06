'use client';

import dynamic from 'next/dynamic';
import { asDynamicModule } from '@/utils/asDynamicModule';

const ReportEmbedPage = dynamic(
  () => import('@/ee-lazy/ReportEmbedPage').then((m) => asDynamicModule(m.ReportEmbedPage, () => null)),
  { ssr: false, loading: () => null },
);

export default function EmbedReportRoute() {
  return <ReportEmbedPage />;
}
