'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Result, Skeleton, Typography } from 'antd';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EmbedBrandingFooter } from '@/components/embed/EmbedBrandingFooter';
import { FeedSnapshotViewer } from '@/app/(dashboard)/feed/components/FeedSnapshotViewer';
import type { FeedItem } from '@/services/socialFeedService';

type Opened = {
  kind: 'chart' | 'dashboard';
  title?: string | null;
  snapshot?: Record<string, unknown> | null;
  updated_at?: string | null;
  live_url?: string | null;
};

type State =
  | { status: 'opening' }
  | { status: 'open'; link: Opened }
  | { status: 'password'; wrong: boolean }
  | { status: 'sign_in' }
  | { status: 'refused'; message: string };

const parentOrigin = () => {
  if (window.parent === window) return '';
  try {
    return window.location.ancestorOrigins?.[0] ?? new URL(document.referrer).origin;
  } catch {
    return '';
  }
};

/** Not fetchApi: a visitor without a session is normal here, not a reason to go to the login page. */
async function openLink(slug: string, password?: string): Promise<State> {
  const res = await fetch(`/api/share-links/open/${encodeURIComponent(slug)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, parent_origin: parentOrigin() }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { status: 'open', link: body };
  const reason = String(body?.message ?? body?.detail ?? '');
  if (reason === 'password_required') return { status: 'password', wrong: false };
  if (reason === 'wrong_password') return { status: 'password', wrong: true };
  if (reason === 'sign_in_required') return { status: 'sign_in' };
  return { status: 'refused', message: reason };
}

function ago(iso: string | null | undefined, t: ReturnType<typeof useTranslations>): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return t('updated_now');
  if (minutes < 60) return t('updated_minutes', { count: minutes });
  return t('updated_hours', { count: Math.round(minutes / 60) });
}

export function ShareLinkPage() {
  const t = useTranslations('share_links');
  const slug = String(useParams()?.slug ?? '');
  const embedded = useSearchParams()?.get('embed') === '1';
  const [state, setState] = useState<State>({ status: 'opening' });
  const [password, setPassword] = useState('');

  const load = useCallback(
    (secret?: string) => {
      setState({ status: 'opening' });
      openLink(slug, secret)
        .then(setState)
        .catch(() => setState({ status: 'refused', message: t('open_failed') }));
    },
    [slug, t],
  );

  useEffect(() => load(), [load]);

  const item = useMemo(() => {
    if (state.status !== 'open' || !state.link.snapshot) return null;
    const { kind, title, snapshot } = state.link;
    return { id: slug, assetType: kind, title: title ?? '', renderMode: 'snapshot', asset: { snapshotPayload: snapshot } } as unknown as FeedItem;
  }, [state, slug]);

  if (state.status === 'opening') {
    return <div style={{ padding: 24 }}><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }
  if (state.status === 'password') {
    return (
      <div style={{ maxWidth: 360, margin: '15vh auto', padding: 24 }}>
        <Typography.Title level={4}>{t('password_needed')}</Typography.Title>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(password);
          }}
        >
          <Input.Password
            autoFocus
            value={password}
            status={state.wrong ? 'error' : undefined}
            aria-label={t('password')}
            onChange={(e) => setPassword(e.target.value)}
          />
          {state.wrong ? <Typography.Text type="danger">{t('password_wrong')}</Typography.Text> : null}
          <Button type="primary" htmlType="submit" block style={{ marginTop: 12 }}>
            {t('password_open')}
          </Button>
        </form>
      </div>
    );
  }
  if (state.status === 'sign_in') {
    return (
      <Result
        status="info"
        title={t('sign_in_title')}
        extra={<Button type="primary" href={`/login?next=${encodeURIComponent(`/s/${slug}`)}`}>{t('sign_in')}</Button>}
      />
    );
  }
  if (state.status === 'refused') {
    return <Result status="warning" title={t('unavailable')} subTitle={state.message} />;
  }
  if (state.link.live_url) {
    return <iframe src={state.link.live_url} title={state.link.title ?? ''} style={{ border: 0, width: '100%', height: '100vh' }} />;
  }
  const updated = ago(state.link.updated_at, t);
  return (
    <div className="aicser-embed-root" style={{ minHeight: '100vh', background: 'var(--ant-color-bg-layout)' }}>
      {embedded ? null : (
        <header style={{ padding: '16px 24px 0' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>{state.link.title}</Typography.Title>
          {updated ? <Typography.Text type="secondary">{updated}</Typography.Text> : null}
        </header>
      )}
      <main style={{ padding: embedded ? 0 : 24 }}>{item ? <FeedSnapshotViewer item={item} /> : null}</main>
      <EmbedBrandingFooter />
    </div>
  );
}
