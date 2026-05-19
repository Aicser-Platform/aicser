'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function HomePage() {
    const router = useRouter();

    useEffect(() => {
        // Immediately redirect to login page
        router.replace('/login');
    }, [router]);

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
            Redirecting to login...
        </div>
    );
}
