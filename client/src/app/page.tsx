'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { getDefaultAppPath } from '@/utils/appPaths';
import { useTranslations } from 'next-intl';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations('app');
  const { isAuthenticated, authLoading } = useAuthStore();

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      router.replace(getDefaultAppPath());
    } else {
      const search = window.location.search;
      const hash = window.location.hash;
      router.replace(`/login${search}${hash}`);
    }
  }, [authLoading, isAuthenticated, router]);

  return (
    <div
      style={{
        display: 'inline-flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        width: '100%',
        fontSize: '16px',
        color: 'var(--ant-color-text, #1f1f1f)',
        background: 'var(--ant-color-bg-layout, #ffffff)',
      }}
    >
      {authLoading
        ? t('loading')
        : isAuthenticated
          ? t('opening_app')
          : t('redirect_login')}
    </div>
  );
}
