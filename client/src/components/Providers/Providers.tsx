'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ReactNode, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ThemeProvider } from './ThemeProvider';
import { BrandThemeProvider } from '@/ee';
import { LocaleProvider } from './LocaleProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from '@/stores/useAuthStore';
import ClientDebugOverlay from '@/components/DevTools/ClientDebugOverlay';

const FeaturebaseMessenger = dynamic(
  () => import('@/ee').then((m) => ({ default: m.FeaturebaseMessenger })),
  { ssr: false, loading: () => null }
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

function AuthInitializer() {
  useEffect(() => {
    return useAuthStore.getState().init();
  }, []);
  return null;
}

function ChunkLoadRecovery() {
  useEffect(() => {
    const reloadKey = 'aicser-chunk-reload';
    const shouldReload = (message: string) =>
      message.includes('ChunkLoadError') ||
      message.includes('Loading chunk') ||
      (message.includes('SyntaxError') && message.includes('_next/static'));

    const reloadOnce = () => {
      if (sessionStorage.getItem(reloadKey)) {
        return;
      }
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      const message = event.message || '';
      if (shouldReload(message)) {
        reloadOnce();
      }
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const message = String(event.reason?.message ?? event.reason ?? '');
      if (shouldReload(message)) {
        reloadOnce();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrandThemeProvider>
            <LocaleProvider>
              <AuthInitializer />
              <ChunkLoadRecovery />
              {children}
              <FeaturebaseMessenger />
              <ClientDebugOverlay />
              {process.env.NODE_ENV === 'development' && (
                <ReactQueryDevtools initialIsOpen={false} />
              )}
            </LocaleProvider>
          </BrandThemeProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AntdRegistry>
  );
}
