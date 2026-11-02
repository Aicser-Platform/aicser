'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Input, Modal, Radio, Select, Skeleton, Space, Typography, message } from 'antd';
import { CopyOutlined, ExportOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import {
  daysLeft,
  getShareLink,
  saveShareLink,
  shareEmbedCode,
  shareUrl,
  turnShareLinkOff,
  turnShareLinkOn,
  type ShareAccess,
  type ShareKind,
  type ShareLink,
  type ShareLinkSettings,
} from '@/services/shareLinks';

const EXPIRY_DAYS = [7, 30, 90];

type Who = 'me' | ShareAccess;

const whoOf = (link: ShareLink | null): Who => (!link || link.status === 'off' ? 'me' : link.access);

const currentSettings = (link: ShareLink | null, access: ShareAccess): ShareLinkSettings => ({
  access,
  live_data: link?.live_data ?? false,
  expires_in_days: daysLeft(link?.expires_at),
  allowed_domains: link?.allowed_domains ?? [],
});

/**
 * One place to share a chart or dashboard: choose who can open it, and the link is ready to send.
 * The link never changes, so options can change after it has gone out.
 */
export function ShareDialog({
  open,
  onClose,
  kind,
  resourceId,
  title,
  onAdvancedEmbed,
}: {
  open: boolean;
  onClose: () => void;
  kind: ShareKind;
  resourceId: string | null;
  title: string;
  onAdvancedEmbed?: () => void;
}) {
  const t = useTranslations('share_links');
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const policy = useQuery({
    queryKey: ['publishing-policy'],
    queryFn: () => fetchApi<{ public?: string }>('/api/feed/publishing/policy'),
    enabled: open,
  });
  const publicOff = policy.data?.public === 'off';

  useEffect(() => {
    if (!open || !resourceId) return;
    setLoading(true);
    getShareLink(kind, resourceId)
      .then(setLink)
      .catch((e) => message.error(e instanceof Error ? e.message : t('save_failed')))
      .finally(() => setLoading(false));
  }, [open, kind, resourceId, t]);

  const run = async (action: () => Promise<ShareLink>) => {
    setSaving(true);
    try {
      setLink(await action());
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const change = (patch: Partial<ShareLinkSettings>) =>
    run(() => saveShareLink(kind, resourceId as string, title, { ...currentSettings(link, link?.access ?? 'organization'), ...patch }));

  const setWho = (who: Who) => {
    if (who === 'me') {
      if (link) void run(() => turnShareLinkOff(link.id));
      return;
    }
    void run(() => saveShareLink(kind, resourceId as string, title, currentSettings(link, who)));
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    message.success(t('copied'));
  };

  const turnOff = async () => {
    if (!link) return;
    const { id } = link;
    await run(() => turnShareLinkOff(id));
    message.open({
      key: 'share-off',
      type: 'success',
      duration: 8,
      content: (
        <>
          {t('turned_off')}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => {
              message.destroy('share-off');
              void run(() => turnShareLinkOn(id));
            }}
          >
            {t('undo')}
          </Button>
        </>
      ),
    });
  };

  const who = whoOf(link);
  const ready = link && who !== 'me';
  const pending = link?.status === 'pending';
  const url = ready ? shareUrl(link.slug) : '';

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('title', { name: title })} width={520} destroyOnHidden>
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Typography.Text strong>{t('who')}</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 6 }}
              value={who}
              loading={saving}
              disabled={saving}
              aria-label={t('who')}
              onChange={(v) => setWho(v as Who)}
              options={[
                { value: 'me', label: t('who_me') },
                { value: 'organization', label: t('who_organization') },
                { value: 'public', label: publicOff ? t('who_public_off') : t('who_public'), disabled: publicOff },
              ]}
            />
          </div>

          {pending ? <Alert type="info" showIcon message={t('pending')} /> : null}

          {ready ? (
            <>
              <Space.Compact style={{ width: '100%' }}>
                <Input readOnly value={url} aria-label={t('link')} onFocus={(e) => e.target.select()} />
                <Button type="primary" icon={<CopyOutlined />} disabled={pending} onClick={() => void copy(url)}>
                  {t('copy')}
                </Button>
                <Button icon={<ExportOutlined />} disabled={pending} href={url} target="_blank" rel="noopener noreferrer">
                  {t('preview')}
                </Button>
              </Space.Compact>
              <Typography.Text type="secondary">{t('views', { count: link.view_count })}</Typography.Text>

              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'options',
                    label: t('options'),
                    children: (
                      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                        <div>
                          <Typography.Text strong>{t('data')}</Typography.Text>
                          <Radio.Group
                            style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}
                            value={link.live_data ? 'live' : 'saved'}
                            disabled={saving}
                            onChange={(e) => void change({ live_data: e.target.value === 'live' })}
                            options={[
                              { value: 'saved', label: t('data_saved') },
                              { value: 'live', label: t('data_live') },
                            ]}
                          />
                        </div>
                        <div>
                          <Typography.Text strong>{t('expires')}</Typography.Text>
                          <Select
                            style={{ width: '100%', marginTop: 6 }}
                            value={link.expires_at ? 'keep' : 'never'}
                            disabled={saving}
                            aria-label={t('expires')}
                            onChange={(v) => {
                              if (v !== 'keep') void change({ expires_in_days: v === 'never' ? null : Number(v) });
                            }}
                            options={[
                              ...(link.expires_at
                                ? [{ value: 'keep', label: new Date(link.expires_at).toLocaleDateString() }]
                                : []),
                              { value: 'never', label: t('expires_never') },
                              ...EXPIRY_DAYS.map((d) => ({ value: String(d), label: t('expires_days', { count: d }) })),
                            ]}
                          />
                        </div>
                        <div>
                          <Typography.Text strong>{t('password')}</Typography.Text>
                          <Space.Compact style={{ width: '100%', marginTop: 6 }}>
                            <Input.Password
                              value={password}
                              aria-label={t('password')}
                              placeholder={link.has_password ? t('password_set') : t('password_none')}
                              onChange={(e) => setPassword(e.target.value)}
                            />
                            <Button
                              disabled={saving || password.length < 4}
                              onClick={() => void change({ password }).then(() => setPassword(''))}
                            >
                              {t('password_save')}
                            </Button>
                            {link.has_password ? (
                              <Button disabled={saving} onClick={() => void change({ clear_password: true })}>
                                {t('password_remove')}
                              </Button>
                            ) : null}
                          </Space.Compact>
                        </div>
                        <Button danger type="link" style={{ padding: 0 }} onClick={() => void turnOff()}>
                          {t('turn_off')}
                        </Button>
                      </Space>
                    ),
                  },
                  {
                    key: 'embed',
                    label: t('embed'),
                    children: (
                      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                        <Input.TextArea readOnly autoSize value={shareEmbedCode(link.slug, title)} aria-label={t('embed')} />
                        <Space wrap>
                          <Button icon={<CopyOutlined />} onClick={() => void copy(shareEmbedCode(link.slug, title))}>
                            {t('copy_code')}
                          </Button>
                          {onAdvancedEmbed ? (
                            <Button type="link" onClick={onAdvancedEmbed}>
                              {t('embed_advanced')}
                            </Button>
                          ) : null}
                        </Space>
                        <div>
                          <Typography.Text strong>{t('sites')}</Typography.Text>
                          <Select
                            mode="tags"
                            style={{ width: '100%', marginTop: 6 }}
                            value={link.allowed_domains}
                            disabled={saving}
                            placeholder={t('sites_any')}
                            aria-label={t('sites')}
                            open={false}
                            onChange={(v: string[]) => void change({ allowed_domains: v })}
                          />
                        </div>
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          ) : null}
        </Space>
      )}
    </Modal>
  );
}

export default ShareDialog;
