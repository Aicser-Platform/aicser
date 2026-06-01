'use client';

import React from 'react';
import { Button, Result } from 'antd';
import { useTranslations } from 'next-intl';

interface ErrorFallbackProps {
  onRetry: () => void;
}

export function ErrorFallback({ onRetry }: ErrorFallbackProps) {
  const t = useTranslations('errors');

  return (
    <div style={{ padding: 24, minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        status="error"
        title={t('boundary_title')}
        subTitle={t('boundary_subtitle')}
        extra={[
          <Button type="primary" key="retry" onClick={onRetry}>
            {t('boundary_retry')}
          </Button>,
          <Button key="home" href="/dashboards">
            {t('boundary_home')}
          </Button>,
        ]}
      />
    </div>
  );
}
