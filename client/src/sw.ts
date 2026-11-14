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

// API/auth/socket traffic bypasses the service worker entirely (registered before
// Serwist so it wins). Routing it through a NetworkOnly handler doubled every request
// in the network panel, added a hop on the hot path, and turned slow upstream
// responses into opaque SW fetch errors instead of the real status.
function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.includes('/socket.io')
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && isBypassPath(url.pathname)) {
    // No respondWith → the browser performs the request itself.
    event.stopImmediatePropagation();
  }
});

serwist.addEventListeners();

// Push notifications (alerts): show them, and open the right page when tapped.
self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return {};
    }
  })() as { title?: string; body?: string; url?: string };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aicser', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url || '/';
  event.waitUntil(self.clients.openWindow(url));
});
