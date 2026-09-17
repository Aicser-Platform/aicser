'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Button, Tooltip } from 'antd';
import { AppstoreOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { DiscoverNotifications } from '@/components/discover/DiscoverNotifications';
import { useAuthStore } from '@/stores/useAuthStore';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { getDefaultAppPath } from '@/utils/appPaths';
import './PublicShell.css';

type Props = {
  children: React.ReactNode;
};

/** Minimal chrome for anonymous /discover — no dashboard sidebar or header. */
export function PublicShell({ children }: Props) {
  const t = useTranslations('discover');
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const { isDarkMode, setIsDarkMode } = useThemeMode();

  // Detail page routes (e.g. /discover/[id]) benefit from a wider container for rich charts/dashboards
  const isDetailPage = Boolean(
    pathname &&
      pathname.startsWith('/discover/') &&
      pathname !== '/discover' &&
      !pathname.startsWith('/discover/author')
  );

  return (
    <div className="public-shell">
      <header className="public-shell-header">
        <Link href="/discover" className="public-shell-brand" aria-label="Aicser Discover">
          <Image
            src="/aiser-logo.png"
            alt="Aicser Logo"
            width={30}
            height={30}
            className="public-shell-brand-logo"
            priority
          />
          <span className="public-shell-brand-title">Aicser</span>
          <span className="public-shell-brand-badge">{t('discover_badge')}</span>
        </Link>
        <nav className="public-shell-nav">
          <Tooltip title={isDarkMode ? t('theme_light') : t('theme_dark')}>
            <Button
              type="text"
              className="public-shell-theme-toggle"
              aria-label={isDarkMode ? t('theme_light') : t('theme_dark')}
              onClick={() => setIsDarkMode(!isDarkMode)}
              icon={isDarkMode ? <SunOutlined className="public-shell-sun-icon" /> : <MoonOutlined />}
            />
          </Tooltip>
          {isAuthenticated ? (
            <>
              <DiscoverNotifications />
              <Link href={getDefaultAppPath()} className="public-shell-open-app-link">
                <Button type="primary" icon={<AppstoreOutlined />} className="public-shell-open-app-btn">
                  {t('open_app')}
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="public-shell-auth-link">
                <Button type="text" className="public-shell-signin-btn">
                  {t('sign_in')}
                </Button>
              </Link>
              <Link href="/login?mode=signup" className="public-shell-auth-link">
                <Button type="primary" className="public-shell-signup-btn">
                  {t('sign_up_free')}
                </Button>
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className={`public-shell-main ${isDetailPage ? 'public-shell-main--detail' : ''}`}>
        {children}
      </main>
      <footer className="public-shell-footer">
        <span>{t('footer_tagline')}</span>
      </footer>
    </div>
  );
}

export default PublicShell;
