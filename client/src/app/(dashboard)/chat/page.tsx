import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Spin } from 'antd';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

function ChatPageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Spin size="large" />
    </div>
  );
}

const EEChatPage = dynamic(
  () => import('../../../ee/chat-page'),
  { ssr: false, loading: ChatPageFallback }
);

export default function ChatPage() {
  if (!isEE) redirect('/dashboards');
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <EEChatPage />
    </Suspense>
  );
}
