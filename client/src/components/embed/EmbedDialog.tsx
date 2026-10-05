'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Checkbox, Form, Input, Modal, Segmented, Select, Space, Tabs, Typography, message } from 'antd';
import { CopyOutlined, LinkOutlined, SafetyOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi, ApiError } from '@/utils/api';
import { useEmbedCode, type EmbedDownload } from '@/hooks/useEmbedCode';
import {
  buildSignedEmbedSnippets,
  copyEmbedText,
  getEmbedOrigin,
  normalizeEmbedDomain,
} from '@/utils/embedSnippet';
import { EmbedCodePanel } from './EmbedCodePanel';
import './EmbedCodePanel.css';

const { Paragraph, Text } = Typography;

/** Link lifetimes offered here; Settings → Embed takes any value up to a year. */
const EXPIRY_HOURS = [24, 168, 720, 2160, 8760] as const;

type ExistingEmbed = { resource_id?: string | null; status?: string; expires_at?: string; kind?: string | null };

export type EmbedDialogProps = {
  open: boolean;
  onClose: () => void;
  scope: 'chart' | 'dashboard';
  resourceId: string | null;
  /** The chart or dashboard name: names the embed and titles the iframe. */
  name?: string;
  /** Dashboards: the page and filters on screen, offered as the embed's starting view. */
  pageId?: string | null;
  filters?: unknown[];
  iframeHeight?: number;
};

/**
 * One embed dialog for charts and dashboards, with the same choices as Settings → Embed:
 * a public link (which sites may show it, how long it lasts, what visitors may download) or a
 * signed link minted by the customer's own server for each visitor.
 */
export function EmbedDialog({
  open,
  onClose,
  scope,
  resourceId,
  name,
  pageId,
  filters,
  iframeHeight = 420,
}: EmbedDialogProps) {
  const t = useTranslations('embed_modal');
  const { createEmbedCode, loading } = useEmbedCode();
  const [domains, setDomains] = useState<string[]>([]);
  const [expiresInHours, setExpiresInHours] = useState<number>(720);
  const [download, setDownload] = useState<EmbedDownload>('none');
  const [keepView, setKeepView] = useState(true);
  const [created, setCreated] = useState<{ embedUrl: string; token?: string } | null>(null);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const [existing, setExisting] = useState<number | null>(null);
  const [lang, setLang] = useState<'node' | 'python' | 'curl'>('node');

  const hasView = scope === 'dashboard' && Boolean(pageId || filters?.length);

  // Each opening starts over: nothing is created until the owner asks for it
  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setError(null);
    setExisting(null);
    if (!resourceId) return;
    let alive = true;
    fetchApi<{ tokens: ExistingEmbed[] }>('/api/embed/tokens')
      .then((res) => {
        if (!alive) return;
        const now = Date.now();
        setExisting(
          (res.tokens || []).filter(
            (e) =>
              e.resource_id === resourceId &&
              e.status === 'active' &&
              e.kind !== 'signed' &&
              (!e.expires_at || Date.parse(e.expires_at) > now),
          ).length,
        );
      })
      .catch(() => alive && setExisting(null));
    return () => {
      alive = false;
    };
  }, [open, resourceId]);

  const snippets = useMemo(
    () => (resourceId ? buildSignedEmbedSnippets({ baseUrl: getEmbedOrigin(), scope, resourceId }) : null),
    [resourceId, scope],
  );

  const create = async () => {
    if (!resourceId) return;
    setError(null);
    try {
      const result = await createEmbedCode({
        scope,
        resourceId,
        name: `Embed: ${name?.trim() || resourceId}`,
        allowedDomains: domains,
        expiresInHours,
        download,
        pageId: hasView && keepView ? pageId : undefined,
        filters: hasView && keepView ? filters : undefined,
      });
      if (!result.embedUrl) throw new Error(t('embed_no_url'));
      setCreated(result);
      setExisting((n) => (n == null ? n : n + 1));
    } catch (e) {
      const upgrade = e instanceof ApiError && e.status === 402;
      setError({ text: upgrade ? t('embed_upgrade_required') : e instanceof Error && e.message ? e.message : t('embed_create_failed'), upgrade });
    }
  };

  const copy = async (text: string) => {
    try {
      await copyEmbedText(text);
      message.success(t('embed_snippet_copied'));
    } catch {
      message.error(t('copy_failed'));
    }
  };

  const expiryLabel = (h: number) =>
    h % 8760 === 0 ? t('embed_expiry_years', { count: h / 8760 }) : h % 24 === 0 ? t('embed_expiry_days', { count: h / 24 }) : t('embed_expiry_hours', { count: h });

  const publicTab = created ? (
    <>
      <EmbedCodePanel
        embedUrl={created.embedUrl}
        token={created.token}
        title={name}
        iframeHeight={iframeHeight}
        openable={domains.length === 0}
        hint={domains.length ? t('embed_ready_domains', { domains: domains.join(', ') }) : t('embed_ready_public')}
      />
      <Button style={{ marginTop: 12 }} onClick={() => setCreated(null)}>
        {t('embed_create_another')}
      </Button>
    </>
  ) : (
    <Form layout="vertical" requiredMark={false} onFinish={() => void create()}>
      <Paragraph type="secondary">{t('embed_public_intro')}</Paragraph>
      <Form.Item label={t('embed_allowed_sites')} extra={t('embed_allowed_sites_help')}>
        <Select
          mode="tags"
          value={domains}
          tokenSeparators={[',', ' ']}
          placeholder="example.com"
          open={false}
          suffixIcon={null}
          onChange={(values: string[]) =>
            setDomains(Array.from(new Set(values.map(normalizeEmbedDomain).filter(Boolean))).slice(0, 20))
          }
          aria-label={t('embed_allowed_sites')}
        />
      </Form.Item>
      <Space size={16} wrap style={{ width: '100%' }} align="start">
        <Form.Item label={t('embed_expires_in')} style={{ minWidth: 180 }}>
          <Select
            value={expiresInHours}
            onChange={setExpiresInHours}
            options={EXPIRY_HOURS.map((h) => ({ value: h, label: expiryLabel(h) }))}
          />
        </Form.Item>
        <Form.Item label={t('embed_visitors_download')} style={{ minWidth: 240 }}>
          <Select
            value={download}
            onChange={setDownload}
            options={[
              { value: 'none', label: t('embed_download_none') },
              { value: 'image', label: t('embed_download_image') },
              { value: 'data', label: t('embed_download_data') },
            ]}
          />
        </Form.Item>
      </Space>
      {hasView ? (
        <Form.Item extra={t('embed_keep_view_help')}>
          <Checkbox checked={keepView} onChange={(e) => setKeepView(e.target.checked)}>
            {t('embed_keep_view')}
          </Checkbox>
        </Form.Item>
      ) : null}
      {error ? (
        <Alert
          type={error.upgrade ? 'warning' : 'error'}
          showIcon
          message={error.text}
          style={{ marginBottom: 12 }}
          action={
            error.upgrade ? (
              <Button size="small" type="primary" onClick={() => window.dispatchEvent(new CustomEvent('open-pricing-modal'))}>
                {t('embed_upgrade')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button type="primary" htmlType="submit" loading={loading} disabled={!resourceId}>
          {t('embed_create_code')}
        </Button>
        {existing ? (
          <Link href="/settings?tab=embed">
            <LinkOutlined /> {t('embed_existing_count', { count: existing })}
          </Link>
        ) : null}
      </Space>
    </Form>
  );

  const signedTab = snippets ? (
    <div className="embed-code-panel">
      <Paragraph type="secondary">{t('embed_signed_intro')}</Paragraph>
      <ol className="embed-dialog__steps">
        <li>
          {t.rich('embed_signed_step_key', {
            link: (chunks) => <Link href="/settings?tab=api-keys">{chunks}</Link>,
          })}
        </li>
        <li>{t('embed_signed_step_sign')}</li>
        <li>{t('embed_signed_step_iframe')}</li>
      </ol>
      <Segmented
        value={lang}
        onChange={(v) => setLang(v as typeof lang)}
        options={[
          { label: 'Node.js', value: 'node' },
          { label: 'Python', value: 'python' },
          { label: 'cURL', value: 'curl' },
        ]}
      />
      <Input.TextArea
        className="embed-code-panel__code"
        value={snippets[lang]}
        readOnly
        autoSize={{ minRows: 8, maxRows: 18 }}
        aria-label={t('embed_signed_code')}
      />
      <div className="embed-code-panel__actions">
        <Button type="primary" icon={<CopyOutlined />} onClick={() => void copy(snippets[lang])}>
          {t('embed_copy_code')}
        </Button>
        <Text type="secondary">
          {scope === 'chart' ? t('embed_signed_id_chart', { id: resourceId ?? '' }) : t('embed_signed_id_dashboard', { id: resourceId ?? '' })}
        </Text>
      </div>
    </div>
  ) : null;

  return (
    <Modal
      title={name ? t('embed_dialog_title', { name }) : t('embed_get_code')}
      open={open}
      onCancel={onClose}
      width={760}
      footer={null}
      destroyOnHidden
    >
      <Tabs
        items={[
          { key: 'public', label: t('embed_tab_public'), children: publicTab },
          {
            key: 'signed',
            label: (
              <span>
                <SafetyOutlined /> {t('embed_tab_signed')}
              </span>
            ),
            children: signedTab,
          },
        ]}
      />
    </Modal>
  );
}

export default EmbedDialog;
