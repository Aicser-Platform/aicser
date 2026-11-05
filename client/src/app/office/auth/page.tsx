'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { Result, Spin } from 'antd';
import { fetchApi } from '@/utils/api';

declare const Office: any;

/** Opened by the Excel add-in as an Office dialog (a normal window, so sign-in works). Hands a
 *  working-day token back to the taskpane, then closes. */
export default function OfficeAuth() {
  const t = useTranslations('office');
  const [error, setError] = useState<string | null>(null);
  const [officeReady, setOfficeReady] = useState(false);

  useEffect(() => {
    if (!officeReady) return;
    fetchApi<{ token: string }>('/api/office/token', { method: 'POST' })
      .then(({ token }) => Office.context.ui.messageParent(JSON.stringify({ token })))
      .catch((e) => setError(String(e?.message || e)));
  }, [officeReady]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--ant-color-bg-container)' }}>
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" onLoad={() => Office.onReady(() => setOfficeReady(true))} />
      {error ? <Result status="error" title={t('sign_in_failed')} subTitle={error} /> : <Spin tip={t('signing_in')}><div style={{ width: 200, height: 80 }} /></Spin>}
    </div>
  );
}
