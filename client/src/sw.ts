import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const AUTH_SENSITIVE_PATHS = [
  '/',
  '/login',
  '/logout',
  '/reset-password',
  '/invite/accept',
  '/invite/set-password',
];

function isAuthSensitivePath(pathname: string): boolean {
  return AUTH_SENSITIVE_PATHS.some((path) => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Auth pages must never come from a stale document/RSC cache. A cached
    // login/logout shell can strand users after auth cookies change.
    {
      matcher({ request, url, sameOrigin }) {
        if (!sameOrigin || request.method !== 'GET') return false;
        if (!isAuthSensitivePath(url.pathname)) return false;
        return (
          request.mode === 'navigate' ||
          request.destination === 'document' ||
          request.headers.get('RSC') === '1' ||
          request.headers.has('Next-Router-State-Tree')
        );
      },
      handler: new NetworkOnly(),
    },
    // Never cache authenticated API/auth traffic — analytics must stay fresh.
    {
      matcher({ request, url }) {
        if (request.method !== 'GET') return false;
        const path = url.pathname;
        return (
          path.startsWith('/api/') ||
          path.startsWith('/auth/') ||
          path.includes('/socket.io')
        );
      },
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
