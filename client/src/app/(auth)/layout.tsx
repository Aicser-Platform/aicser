'use client';

import { useAuthStore } from '@/stores/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, Suspense } from 'react';
import { getDefaultAppPath } from '@/utils/appPaths';

function RedirectAuthenticatedInner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    const next = searchParams.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : getDefaultAppPath();
    router.replace(dest);
  }, [authLoading, isAuthenticated, router, searchParams]);

  if (authLoading) return null;
  if (isAuthenticated) return null;
  return <>{children}</>;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RedirectAuthenticatedInner>{children}</RedirectAuthenticatedInner>
    </Suspense>
  );
}
