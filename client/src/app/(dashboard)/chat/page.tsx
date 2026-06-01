import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Spin } from 'antd';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEChatPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.ChatPage })),
  { ssr: false }
);

function ChatPageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Spin size="large" />
    </div>
  );
}

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <EEChatPage />
    </Suspense>
  );
}
