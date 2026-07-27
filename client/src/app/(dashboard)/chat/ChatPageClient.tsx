'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { Spin } from 'antd';

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
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <EEChatPage />
    </Suspense>
  );
}
