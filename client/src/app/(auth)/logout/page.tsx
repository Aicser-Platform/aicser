 'use client';
export const dynamic = 'force-dynamic';
// Simple dynamic configuration that actually works

import LoadingScreen from '@/components/LoadingScreen/LoadingScreen';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useRouter } from 'next/navigation';
import { useLayoutEffect } from 'react';

export default function LogoutPage() {
    const { logout } = useAuth();
    const router = useRouter();

    useLayoutEffect(() => {
        let active = true;
        logout()
            .catch(() => {
                // Still leave the user on the login screen if the best-effort
                // server-side logout call fails.
            })
            .finally(() => {
                if (active) router.replace('/login');
            });
        return () => {
            active = false;
        };
    }, [logout, router]);

    // Show loading screen while redirecting
    return <LoadingScreen />;
}
