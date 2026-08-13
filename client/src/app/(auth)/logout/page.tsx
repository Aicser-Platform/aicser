 'use client';
export const dynamic = 'force-dynamic';
// Simple dynamic configuration that actually works

import LoadingScreen from '@/components/LoadingScreen/LoadingScreen';
import { resetServiceWorkerCaches } from '@/components/pwa/serviceWorkerReset';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useLayoutEffect } from 'react';

export default function LogoutPage() {
    const { logout } = useAuth();

    useLayoutEffect(() => {
        let active = true;
        (async () => {
            try {
                await logout();
            } catch {
                // Still leave the user on the login screen if the best-effort
                // server-side logout call fails.
            } finally {
                await resetServiceWorkerCaches();
                if (active) window.location.replace('/login');
            }
        })();
        return () => {
            active = false;
        };
    }, [logout]);

    // Show loading screen while redirecting
    return <LoadingScreen />;
}
