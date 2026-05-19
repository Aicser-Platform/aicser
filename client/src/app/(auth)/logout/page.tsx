 'use client';
export const dynamic = 'force-dynamic';
// Simple dynamic configuration that actually works

import LoadingScreen from '@/components/LoadingScreen/LoadingScreen';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useLayoutEffect } from 'react';

export default function LogoutPage() {
    const { logout } = useAuth();

    useLayoutEffect(() => {
        // Clear localStorage

        // Optional: Clear specific items only
        // localStorage.removeItem('token')
        // localStorage.removeItem('user')

        // Redirect to login page
        // router.push("/login");
        logout();
    });

    // Show loading screen while redirecting
    return <LoadingScreen />;
}
