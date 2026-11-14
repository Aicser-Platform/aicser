'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { PageLoading } from '@/components/ui/AppLoadingIndicator';

const AiAgentBuilderPage = dynamic(() => import('@/ee-lazy/AiAgentBuilderPage').then((m) => ({ default: m.AiAgentBuilderPage })), { ssr: false, loading: PageLoading });

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AiAgentBuilderPage id={id} />;
}
