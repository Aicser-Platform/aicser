const SERWIST_CACHE_PREFIX = 'serwist-';
const PWA_RUNTIME_CACHE_NAMES = new Set([
  'cross-origin',
  'css',
  'fonts',
  'images',
  'js',
  'others',
  'pages',
  'pages-rsc',
  'pages-rsc-prefetch',
  'start-url',
]);

function isPwaCacheName(key: string): boolean {
  return key.startsWith(SERWIST_CACHE_PREFIX) || PWA_RUNTIME_CACHE_NAMES.has(key);
}

export async function resetServiceWorkerCaches(): Promise<void> {
  if (typeof window === 'undefined') return;

  const jobs: Promise<unknown>[] = [];

  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
    );
  }

  if ('caches' in window) {
    jobs.push(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(isPwaCacheName)
              .map((key) => caches.delete(key)),
          ),
        ),
    );
  }

  await Promise.allSettled(jobs);
}
