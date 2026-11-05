'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { App, Space, Switch, Typography } from 'antd';
import { fetchApi } from '@/utils/api';

function toBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(clean);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function keysOf(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' };
}

/** "Alerts on this device": asks the browser, then registers this device. Hidden when push isn't set up. */
export function PushToggle() {
  const t = useTranslations('settings');
  const { message } = App.useApp();
  const [key, setKey] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    fetchApi<{ key: string | null }>('/api/notifications/push/key').then((r) => setKey(r.key)).catch(() => setKey(null));
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setOn(!!sub)).catch(() => undefined);
  }, []);

  if (!key) return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const current = await reg.pushManager.getSubscription();
      if (next) {
        if ((await Notification.requestPermission()) !== 'granted') {
          message.warning(t('push_blocked'));
          return;
        }
        const sub = current ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }));
        await fetchApi('/api/notifications/push/subscribe', { method: 'POST', body: JSON.stringify(keysOf(sub)) });
        setOn(true);
      } else if (current) {
        await fetchApi('/api/notifications/push/unsubscribe', { method: 'POST', body: JSON.stringify(keysOf(current)) });
        await current.unsubscribe();
        setOn(false);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('push_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
      <span>
        <Typography.Text strong style={{ display: 'block' }}>{t('push_title')}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('push_desc')}</Typography.Text>
      </span>
      <Switch checked={on} loading={busy} onChange={(v) => void toggle(v)} aria-label={t('push_title')} />
    </Space>
  );
}
