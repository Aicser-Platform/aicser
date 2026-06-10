'use client';

import React, { useMemo, useState } from 'react';
import { Alert, Button, Input, Segmented, Spin, Typography, message } from 'antd';
import {
  CopyOutlined,
  CodeOutlined,
  ExportOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { buildIframeSnippet, copyEmbedText } from '@/utils/embedSnippet';
import './EmbedCodePanel.css';

const { Paragraph } = Typography;

export type EmbedCodePanelProps = {
  embedUrl: string;
  loading?: boolean;
  token?: string;
  title?: string;
  iframeHeight?: number;
  showPreview?: boolean;
  hint?: string;
};

export function EmbedCodePanel({
  embedUrl,
  loading = false,
  token,
  title,
  iframeHeight = 480,
  showPreview = true,
  hint,
}: EmbedCodePanelProps) {
  const t = useTranslations('embed_modal');
  const [view, setView] = useState<'iframe' | 'url' | 'preview'>('iframe');

  const iframeCode = useMemo(
    () => (embedUrl ? buildIframeSnippet(embedUrl, { height: iframeHeight, title }) : ''),
    [embedUrl, iframeHeight, title],
  );

  const copy = async (text: string, successKey: 'copied_clipboard' | 'embed_snippet_copied' | 'embed_url_copied') => {
    if (!text) return;
    try {
      await copyEmbedText(text);
      message.success(t(successKey));
    } catch {
      message.error(t('copy_failed'));
    }
  };

  if (loading) {
    return (
      <div className="embed-code-panel" style={{ textAlign: 'center', padding: 24 }}>
        <Spin tip={t('embed_generating')} />
      </div>
    );
  }

  if (!embedUrl) {
    return <Alert type="info" showIcon message={t('embed_no_url')} />;
  }

  return (
    <div className="embed-code-panel">
      {hint ? (
        <Paragraph type="secondary" className="embed-code-panel__hint">
          {hint}
        </Paragraph>
      ) : (
        <Paragraph type="secondary" className="embed-code-panel__hint">
          {t('embed_instructions')}
        </Paragraph>
      )}

      <Segmented
        value={view}
        onChange={(value) => setView(value as typeof view)}
        options={[
          { label: t('embed_iframe_code'), value: 'iframe', icon: <CodeOutlined /> },
          { label: t('embed_direct_url'), value: 'url', icon: <LinkOutlined /> },
          ...(showPreview
            ? [{ label: t('embed_preview'), value: 'preview' as const, icon: <ExportOutlined /> }]
            : []),
        ]}
      />

      {view === 'iframe' ? (
        <>
          <Input.TextArea
            className="embed-code-panel__code"
            value={iframeCode}
            readOnly
            autoSize={{ minRows: 5, maxRows: 10 }}
            aria-label={t('embed_iframe_code')}
          />
          <div className="embed-code-panel__actions">
            <Button type="primary" icon={<CopyOutlined />} onClick={() => void copy(iframeCode, 'embed_snippet_copied')}>
              {t('embed_copy_iframe')}
            </Button>
            <Button icon={<ExportOutlined />} href={embedUrl} target="_blank" rel="noopener noreferrer">
              {t('embed_open_preview')}
            </Button>
          </div>
        </>
      ) : null}

      {view === 'url' ? (
        <>
          <Input.TextArea
            className="embed-code-panel__code"
            value={embedUrl}
            readOnly
            autoSize={{ minRows: 3, maxRows: 6 }}
            aria-label={t('embed_direct_url')}
          />
          <div className="embed-code-panel__actions">
            <Button type="primary" icon={<CopyOutlined />} onClick={() => void copy(embedUrl, 'embed_url_copied')}>
              {t('embed_copy_url')}
            </Button>
          </div>
        </>
      ) : null}

      {view === 'preview' && showPreview ? (
        <div className="embed-code-panel__preview">
          <div className="embed-code-panel__preview-label">{t('embed_preview_note')}</div>
          <iframe
            className="embed-code-panel__preview-frame"
            src={embedUrl}
            title={title || t('embed_preview')}
            style={{ height: iframeHeight }}
            allow="clipboard-write"
          />
        </div>
      ) : null}

      {token ? (
        <>
          <Paragraph strong style={{ marginBottom: 4, marginTop: 4 }}>
            {t('embed_token_label')}
          </Paragraph>
          <div className="embed-code-panel__token">{token}</div>
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(token, 'copied_clipboard')}>
            {t('embed_copy_token')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

export default EmbedCodePanel;
