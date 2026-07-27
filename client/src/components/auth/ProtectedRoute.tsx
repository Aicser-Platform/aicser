'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/useAuthStore';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const t = useTranslations('layout');
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      const search = window.location.search;
      const hash = window.location.hash;
      router.replace(`/login${search}${hash}`);
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading) {
    return <AppLoadingIndicator variant="full" tip={t('loading')} />;
  }
  if (!isAuthenticated) return null;
  return <>{children}</>;
}
