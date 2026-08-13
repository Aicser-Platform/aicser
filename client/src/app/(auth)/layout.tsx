'use client';

import { useAuthStore } from '@/stores/useAuthStore';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, Suspense } from 'react';
import { getDefaultAppPath } from '@/utils/appPaths';

function RedirectAuthenticatedInner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLogoutRoute = pathname === '/logout';
  const isInviteRoute = pathname?.startsWith('/invite/');
  const isResetPasswordRoute = pathname === '/reset-password';

  useEffect(() => {
    if (isLogoutRoute) return;
    if (isInviteRoute) return;
    if (isResetPasswordRoute) return;
    if (authLoading || !isAuthenticated) return;
    const next = searchParams?.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : getDefaultAppPath();
    router.replace(dest);
  }, [authLoading, isAuthenticated, isInviteRoute, isLogoutRoute, isResetPasswordRoute, router, searchParams]);

  if (authLoading && !isLogoutRoute && !isInviteRoute && !isResetPasswordRoute) return null;
  if (isAuthenticated && !isLogoutRoute && !isInviteRoute && !isResetPasswordRoute) return null;
  return <>{children}</>;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RedirectAuthenticatedInner>{children}</RedirectAuthenticatedInner>
    </Suspense>
  );
}
