'use client';

import dynamic from 'next/dynamic';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';

const AiAgentsPage = dynamic(() => import('@/ee-lazy/AiAgentsPage').then((m) => ({ default: m.AiAgentsPage })), { ssr: false, loading: PageLoading });

export default function Page() {
  return <AiAgentsPage />;
}
