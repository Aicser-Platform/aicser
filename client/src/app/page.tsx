'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { AUTH_SUCCESS_PATH } from '@/auth/routes';

export const dynamic = 'force-dynamic';

export default function HomePage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuthStore();

    useEffect(() => {
        if (!authLoading) {
            router.replace(isAuthenticated ? AUTH_SUCCESS_PATH : '/login');
        }
    }, [router, isAuthenticated, authLoading]);

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
            Redirecting...
        </div>
    );
}
