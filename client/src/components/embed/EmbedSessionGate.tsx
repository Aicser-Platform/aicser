'use client';

import React from 'react';
import { Alert, Result, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import type { EmbedSessionState } from '@/hooks/useEmbedSession';

/**
 * Shows an embed page's content once its session is open (useEmbedSession): a spinner while
 * the link is exchanged, a plain explanation when it can't be (expired, already used, wrong
 * site), and a banner when the session ran out and the host page didn't renew it.
 */
export function EmbedSessionGate({
  session,
  children,
}: {
  session: EmbedSessionState;
  children: React.ReactNode;
}) {
  const t = useTranslations('embed_session');
  if (session.status === 'opening') {
    return (
      <div style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin aria-label={t('opening')} />
      </div>
    );
  }
  if (session.status === 'error' && !session.token) {
    return <Result status="warning" title={t('error_title')} subTitle={session.error || t('error_message')} />;
  }
  return (
    <>
      {session.status === 'expired' ? (
        <Alert
          banner
          type="warning"
          message={t('expired')}
          style={{ position: 'sticky', top: 0, zIndex: 20 }}
        />
      ) : null}
      {children}
    </>
  );
}
