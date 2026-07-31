'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useAiAvailability } from '@/hooks/useAiAvailability';

function ChatPageFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
      }}
    >
      <Spin size="large" />
    </div>
  );
}

const EEChatPage = dynamic(() => import('../../../ee/chat-page'), {
  ssr: false,
  loading: ChatPageFallback,
});

export default function ChatPageClient() {
  const router = useRouter();
  const aiAvailability = useAiAvailability();

  useEffect(() => {
    if (!aiAvailability.loading && !aiAvailability.available) {
      router.replace('/dashboards');
    }
  }, [aiAvailability.available, aiAvailability.loading, router]);

  if (aiAvailability.loading || !aiAvailability.available) {
    return <ChatPageFallback />;
  }

  return (
    <Suspense fallback={<ChatPageFallback />}>
      <EEChatPage />
    </Suspense>
  );
}
