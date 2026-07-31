'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Spin } from 'antd';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('chat');
  const aiAvailability = useAiAvailability();

  useEffect(() => {
    if (!aiAvailability.loading && !aiAvailability.available) {
      router.prefetch('/settings?tab=api-keys&subtab=providers');
    }
  }, [aiAvailability.available, aiAvailability.loading, router]);

  if (aiAvailability.loading) {
    return <ChatPageFallback />;
  }

  if (!aiAvailability.available) {
    return (
      <div className="relative min-h-screen">
        <div aria-hidden className="pointer-events-none min-h-screen select-none blur-[4px]">
          <Suspense fallback={<ChatPageFallback />}>
            <EEChatPage />
          </Suspense>
        </div>
        <Modal
          open
          centered
          closable={false}
          title={t('ai_provider_key_required_title')}
          footer={[
            <Button
              key="configure"
              type="primary"
              onClick={() => router.push('/settings?tab=api-keys&subtab=providers')}
            >
              {t('configure_api_key_action')}
            </Button>,
          ]}
        >
          <p className="mb-0 text-sm text-[var(--ant-color-text-secondary)]">
            {t('ai_provider_key_required_desc')}
          </p>
        </Modal>
      </div>
    );
  }

  return (
    <Suspense fallback={<ChatPageFallback />}>
      <EEChatPage />
    </Suspense>
  );
}
