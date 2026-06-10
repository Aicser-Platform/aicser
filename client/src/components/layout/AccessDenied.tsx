'use client';

import React from 'react';
import { Alert, Button, Space } from 'antd';
import { LockOutlined, TeamOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export type AccessDeniedProps = {
  title?: string;
  description?: string;
  permissionHint?: string;
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
};

export function AccessDenied({
  title,
  description,
  permissionHint,
  primaryAction,
  secondaryAction,
}: AccessDeniedProps) {
  const t = useTranslations('access_denied');

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <Alert
        type="warning"
        showIcon
        icon={<LockOutlined />}
        message={title ?? t('title')}
        description={
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <span>{description ?? t('description')}</span>
            {permissionHint ? (
              <span style={{ fontSize: 13, opacity: 0.85 }}>{permissionHint}</span>
            ) : null}
            <Space wrap>
              {primaryAction ? (
                <Link href={primaryAction.href}>
                  <Button type="primary">{primaryAction.label}</Button>
                </Link>
              ) : (
                <Link href="/settings?tab=team">
                  <Button type="primary" icon={<TeamOutlined />}>
                    {t('contact_admin')}
                  </Button>
                </Link>
              )}
              {secondaryAction ? (
                <Link href={secondaryAction.href}>
                  <Button>{secondaryAction.label}</Button>
                </Link>
              ) : (
                <Link href={getFallbackHome()}>
                  <Button>{t('go_home')}</Button>
                </Link>
              )}
            </Space>
          </Space>
        }
      />
    </div>
  );
}

function getFallbackHome(): string {
  const isEE = ['enterprise', 'ee'].includes(
    (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
  );
  return isEE ? '/dashboards' : '/dashboards';
}
