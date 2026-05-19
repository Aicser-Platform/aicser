'use client';

import CustomLayout from '@/layouts/DashboardLayout/DashboardLayout';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import dynamic from 'next/dynamic';
import '@/styles/globals.css';

const BillingSuccessHandler = dynamic(
  () => import('@/ee').then((m) => ({ default: m.BillingSuccessHandler })),
  { ssr: false, loading: () => null }
);
const TrialExpiryBanner = dynamic(
  () => import('@/ee').then((m) => ({ default: m.TrialExpiryBanner })),
  { ssr: false, loading: () => null }
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading) return null;
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

const DashboardLayout: React.FC<{ children: React.ReactNode }> = React.memo(({ children }) => {
  return (
    <ProtectedRoute>
      <TrialExpiryBanner />
      <CustomLayout>
        {children}
      </CustomLayout>
      <BillingSuccessHandler />
    </ProtectedRoute>
  );
});

DashboardLayout.displayName = 'DashboardLayout';

export default DashboardLayout;
