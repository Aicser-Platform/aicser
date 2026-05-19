'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ReactNode, useEffect } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { BrandThemeProvider } from '@/ee';
import { LocaleProvider } from './LocaleProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import dynamic from 'next/dynamic';
import { useAuthStore } from '@/stores/useAuthStore';

const ClientDebugOverlay = dynamic(() => import('@/components/DevTools/ClientDebugOverlay'), { ssr: false });

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

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrandThemeProvider>
            <LocaleProvider>
              <AuthInitializer />
              {children}
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
