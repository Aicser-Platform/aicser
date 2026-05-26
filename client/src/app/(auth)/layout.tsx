'use client';

import { useAuthStore } from '@/stores/useAuthStore';
import { useRouter } from 'next/navigation';
import React, { useEffect } from 'react';
import { AUTH_SUCCESS_PATH } from '@/auth/routes';

function RedirectAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace(AUTH_SUCCESS_PATH);
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading) return null;
  if (isAuthenticated) return null;
  return <>{children}</>;
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RedirectAuthenticated>
      {children}
    </RedirectAuthenticated>
  );
}
