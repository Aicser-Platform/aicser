'use client';

import CustomLayout from '@/layouts/DashboardLayout/DashboardLayout';
import React, { useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import dynamic from 'next/dynamic';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import '@/app/globals.css';

const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

const BillingSuccessHandler = dynamic(
  () => import('@/ee').then((m) => ({ default: m.BillingSuccessHandler })),
  { ssr: false, loading: () => null }
);
const TrialExpiryBanner = dynamic(
  () => import('@/ee').then((m) => ({ default: m.TrialExpiryBanner })),
  { ssr: false, loading: () => null }
);

/**
 * Initialises the EE subscription store on every dashboard mount.
 * The CE stub's init() is a noop, so this is safe in both editions.
 * Without this call the store stays at planType='free' (default) forever.
 */
function SubscriptionInitializer() {
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !isEE) return;
    // Trigger EE subscription store init whenever the user becomes authenticated.
    // Always init — don't skip on planType='team' since it may be stale from a
    // previous session or a DB update that hasn't propagated to the store yet.
    import('@/stores/useSubscriptionStore')
      .then(({ useSubscriptionStore }) => {
        const store = (useSubscriptionStore as unknown as {
          getState?: () => { init: () => Promise<void>; planType: string };
        }).getState?.();
        if (store) void store.init();
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // The store otherwise only fetches once per login — a plan change made
  // outside the in-app upgrade flow (trial provisioned via billing webhook,
  // admin action, etc.) during a long-running session never propagates until
  // something explicitly refetches. Bringing the tab back into focus is a
  // reasonable, low-noise moment to check — refreshIfStale no-ops if the last
  // fetch was under a minute ago, so this doesn't hammer the API.
  useEffect(() => {
    if (!isAuthenticated || !isEE) return;
    const onFocus = () => {
      import('@/stores/useSubscriptionStore')
        .then(({ useSubscriptionStore }) => {
          const store = (useSubscriptionStore as unknown as {
            getState?: () => { refreshIfStale: (maxAgeMs?: number) => Promise<void> };
          }).getState?.();
          if (store) void store.refreshIfStale();
        })
        .catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isAuthenticated]);

  return null;
}

const DashboardLayout: React.FC<{ children: React.ReactNode }> = React.memo(({ children }) => {
  return (
    <ProtectedRoute>
      <SubscriptionInitializer />
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
