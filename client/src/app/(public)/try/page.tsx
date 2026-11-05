'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Divider, Form, Input, Spin, Typography } from 'antd';
import { useTranslations } from 'next-intl';

interface SandboxConfig {
  enabled: boolean;
  human_check_site_key: string | null;
  guest_days: number;
  verified_days: number;
}

interface Turnstile {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => void;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/sandbox/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || (typeof data?.detail === 'string' ? data.detail : ''));
  return data as T;
}

/** Try Aicser without an account: an address gets three days, no address gets one. */
export default function TryPage() {
  const t = useTranslations('sandbox');
  const [config, setConfig] = useState<SandboxConfig | null | undefined>(undefined);
  const [codeFor, setCodeFor] = useState<{ email: string; company?: string; phone?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [humanToken, setHumanToken] = useState('');
  const [accepted, setAccepted] = useState(false);
  const humanBox = useRef<HTMLDivElement>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    call<SandboxConfig>('config').then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    const siteKey = config?.human_check_site_key;
    if (!siteKey || !humanBox.current) return;
    const box = humanBox.current;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = () => (window as unknown as { turnstile: Turnstile }).turnstile.render(box, { sitekey: siteKey, callback: setHumanToken });
    document.head.appendChild(script);
  }, [config]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError((err as Error).message || t('failed'));
      setBusy(false);
    }
  };

  const open = () => window.location.assign('/chat');

  const start = (withEmail: boolean) => run(async () => {
    const values = form.getFieldsValue();
    const email = withEmail ? (await form.validateFields(['email'])).email : undefined;
    const next = await call<{ next: string }>('start', {
      email, company: values.company || undefined, phone: values.phone || undefined,
      accepted_terms: accepted, human_token: humanToken || undefined,
    });
    if (next.next === 'code') {
      setCodeFor({ email, company: values.company || undefined, phone: values.phone || undefined });
      setBusy(false);
    } else open();
  });

  const verify = (values: { code: string }) => run(async () => {
    await call('verify', { ...codeFor, code: values.code });
    open();
  });

  if (config === undefined) return <Spin style={{ display: 'block', margin: '20vh auto' }} />;
  const ready = accepted && (!config?.human_check_site_key || Boolean(humanToken));

  return (
    <main style={{ maxWidth: 420, margin: '8vh auto', padding: '0 16px' }}>
      <Typography.Title level={2}>{t('try_title')}</Typography.Title>
      {!config?.enabled ? (
        <Alert type="info" showIcon message={t('unavailable')} />
      ) : codeFor ? (
        <Form layout="vertical" onFinish={verify} requiredMark={false}>
          <Form.Item name="code" label={t('code_label', { email: codeFor.email })} rules={[{ required: true, pattern: /^\d{6}$/, message: t('code_rule') }]}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
          <Button type="primary" htmlType="submit" block loading={busy}>{t('verify')}</Button>
        </Form>
      ) : (
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="email" label={t('email')} rules={[{ required: true, type: 'email', message: t('email_rule') }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="company" label={t('company_optional')}>
            <Input autoComplete="organization" maxLength={120} />
          </Form.Item>
          <Form.Item name="phone" label={t('phone_optional')}>
            <Input autoComplete="tel" maxLength={30} />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)}>{t('terms')}</Checkbox>
          </Form.Item>
          <div ref={humanBox} />
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
          <Button type="primary" block disabled={!ready} loading={busy} onClick={() => start(true)}>{t('start_with_email')}</Button>
          <Divider plain>{t('or')}</Divider>
          <Button block disabled={!ready} loading={busy} onClick={() => start(false)}>{t('start_as_guest', { days: config.guest_days })}</Button>
        </Form>
      )}
    </main>
  );
}
