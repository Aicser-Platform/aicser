'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

interface ConsentInfo {
  client_name: string;
  redirect_host: string;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** An outside AI app asks to act as this person. Sign-in comes first; this page is the approval. */
export default function OAuthConsentPage() {
  const t = useTranslations('oauth_consent');
  const params = useMemo(
    () => (typeof window === 'undefined' ? {} : Object.fromEntries(new URLSearchParams(window.location.search))),
    [],
  );
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchApi<ConsentInfo>('/api/mcp-oauth/consent-info', post({ params }))
      .then(setInfo)
      .catch((e) => setError(e instanceof Error && e.message ? e.message : t('failed')));
  }, [params, t]);

  const allow = async () => {
    setBusy(true);
    try {
      const { redirect_to: to } = await fetchApi<{ redirect_to: string }>('/api/mcp-oauth/approve', post({ params }));
      window.location.assign(to);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('failed'));
      setBusy(false);
    }
  };

  const cancel = () => {
    const redirect = (params as Record<string, string>).redirect_uri;
    if (!redirect || !info) return;
    const url = new URL(redirect);
    url.searchParams.set('error', 'access_denied');
    const state = (params as Record<string, string>).state;
    if (state) url.searchParams.set('state', state);
    window.location.assign(url.toString());
  };

  return (
    <main style={{ maxWidth: 460, margin: '12vh auto', padding: '0 16px' }}>
      {error ? <Alert type="error" showIcon message={error} /> : !info ? <Spin style={{ display: 'block', margin: '0 auto' }} /> : (
        <Card>
          <Typography.Title level={3} style={{ marginTop: 0 }}>{t('title', { name: info.client_name })}</Typography.Title>
          <Typography.Paragraph>{t('body')}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t('site', { host: info.redirect_host })} {t('unverified')}</Typography.Paragraph>
          <Space>
            <Button type="primary" loading={busy} onClick={() => void allow()}>{t('allow')}</Button>
            <Button onClick={cancel}>{t('cancel')}</Button>
          </Space>
        </Card>
      )}
    </main>
  );
}
