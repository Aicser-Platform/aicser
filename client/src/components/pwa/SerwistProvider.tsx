'use client';

import React, { useEffect } from 'react';

const isDev = process.env.NODE_ENV === 'development';
const pwaInDev = process.env.NEXT_PUBLIC_PWA_DEV === 'true';

type Props = {
  children: React.ReactNode;
};

/**
 * In dev, drop any service worker left over from a production build on the same origin, plus
 * its caches. Otherwise the old worker keeps intercepting dev requests with stale precached chunks.
 */
async function removeStaleServiceWorkers(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

/**
 * Registers the Serwist-built service worker (/sw.js).
 * Uses manual registration for React 18 compatibility (@serwist/next/react requires React 19).
 */
export function SerwistProvider({ children }: Props) {
  useEffect(() => {
    if (isDev && !pwaInDev) {
      removeStaleServiceWorkers().catch((err) => {
        console.warn('[PWA] Could not remove stale service worker:', err);
      });
      return;
    }
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
