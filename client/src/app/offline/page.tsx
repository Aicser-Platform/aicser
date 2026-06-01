'use client';

import React from 'react';
import { Button, Typography } from 'antd';
import { WifiOutlined, ReloadOutlined } from '@ant-design/icons';
import Image from 'next/image';

const { Title, Paragraph } = Typography;

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        background: 'var(--ant-color-bg-layout, #0d1117)',
        color: 'var(--ant-color-text, #e6edf3)',
        gap: 16,
      }}
    >
      <Image src="/icons/icon-192.png" alt="Aicser" width={72} height={72} priority />
      <WifiOutlined style={{ fontSize: 40, color: 'var(--ant-color-primary, #00c2cb)' }} />
      <Title level={3} style={{ margin: 0 }}>
        You&apos;re offline
      </Title>
      <Paragraph type="secondary" style={{ maxWidth: 420, margin: 0 }}>
        Aicser needs a network connection for live data, AI queries, and dashboards.
        Cached pages may still be available — reconnect to sync.
      </Paragraph>
      <Button type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
        Try again
      </Button>
    </div>
  );
}
