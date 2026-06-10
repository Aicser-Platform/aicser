'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import { CompassOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { DiscoverNotifications } from '@/components/discover/DiscoverNotifications';
import { useAuthStore } from '@/stores/useAuthStore';
import { getDefaultAppPath } from '@/utils/appPaths';
import './PublicShell.css';

type Props = {
  children: React.ReactNode;
};

/** Minimal chrome for anonymous /discover — no dashboard sidebar or header. */
export function PublicShell({ children }: Props) {
  const t = useTranslations('discover');
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="public-shell">
      <header className="public-shell-header">
        <Link href="/discover" className="public-shell-brand">
          <CompassOutlined />
          <span>{t('brand')}</span>
        </Link>
        <nav className="public-shell-nav">
          {isAuthenticated ? (
            <>
              <DiscoverNotifications />
              <Link href={getDefaultAppPath()}>
                <Button type="primary">{t('open_app')}</Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button type="text">{t('sign_in')}</Button>
              </Link>
              <Link href="/login?mode=signup">
                <Button type="primary">{t('sign_up_free')}</Button>
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="public-shell-main">{children}</main>
      <footer className="public-shell-footer">
        <span>{t('footer_tagline')}</span>
      </footer>
    </div>
  );
}

export default PublicShell;
