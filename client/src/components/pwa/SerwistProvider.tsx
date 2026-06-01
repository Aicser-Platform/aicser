'use client';

import React, { useEffect } from 'react';

const isDev = process.env.NODE_ENV === 'development';
const pwaInDev = process.env.NEXT_PUBLIC_PWA_DEV === 'true';

type Props = {
  children: React.ReactNode;
};

/**
 * Registers the Serwist-built service worker (/sw.js).
 * Uses manual registration for React 18 compatibility (@serwist/next/react requires React 19).
 */
export function SerwistProvider({ children }: Props) {
  useEffect(() => {
    if (isDev && !pwaInDev) return;
    if (!('serviceWorker' in navigator)) return;

    let active = true;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        if (active) console.warn('[PWA] Service worker registration failed:', err);
      });

    const reloadOnOnline = () => {
      if (navigator.onLine) window.location.reload();
    };
    window.addEventListener('online', reloadOnOnline);

    return () => {
      active = false;
      window.removeEventListener('online', reloadOnOnline);
    };
  }, []);

  return <>{children}</>;
}
