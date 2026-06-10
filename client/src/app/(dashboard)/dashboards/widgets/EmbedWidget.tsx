'use client';

import React, { useState } from 'react';
import { Empty, Alert } from 'antd';
import { LinkOutlined } from '@ant-design/icons';

export interface EmbedWidgetProps {
  config?: {
    url?: string;
    allowScrolling?: boolean;
    borderRadius?: number;
    /** allow-popups allow-forms etc — space-separated sandbox tokens */
    sandboxExtra?: string;
    /** iframe title for accessibility */
    frameTitle?: string;
  };
  readOnly?: boolean;
}

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function EmbedWidget({ config = {} }: EmbedWidgetProps) {
  const { url, allowScrolling = true, borderRadius = 0, sandboxExtra = '', frameTitle = 'Embedded content' } = config;
  const [loadError, setLoadError] = useState(false);

  if (!url) {
    return (
      <div className="widget-center" style={{ flexDirection: 'column', gap: 8 }}>
        <LinkOutlined style={{ fontSize: 28, color: 'var(--studio-text-muted)' }} />
        <Empty description="No embed URL set" imageStyle={{ height: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--studio-text-muted)' }}>Set URL in properties →</span>
      </div>
    );
  }

  if (!isAllowedUrl(url)) {
    return (
      <div className="widget-center" style={{ padding: 16 }}>
        <Alert type="error" message="Invalid URL" description="Only http:// and https:// URLs are supported." showIcon />
      </div>
    );
  }

  const sandbox = [
    'allow-scripts',
    'allow-same-origin',
    'allow-popups',
    'allow-forms',
    sandboxExtra,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius, position: 'relative' }}>
      {loadError && (
        <div className="widget-center" style={{ position: 'absolute', inset: 0 }}>
          <Alert
            type="warning"
            message="Embed blocked"
            description="This site may not allow embedding via iframe. Try opening it directly."
            showIcon
          />
        </div>
      )}
      <iframe
        src={url}
        title={frameTitle}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius,
          display: loadError ? 'none' : 'block',
        }}
        sandbox={sandbox}
        scrolling={allowScrolling ? 'yes' : 'no'}
        allowFullScreen
        loading="lazy"
        onError={() => setLoadError(true)}
      />
    </div>
  );
}

export default EmbedWidget;
