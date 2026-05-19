export const dynamic = 'force-dynamic';

import React from 'react';
import { Providers } from '@/components/Providers/Providers';
import GlobalErrorBoundary from '@/components/layout/GlobalErrorBoundary';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Aicser - AI Data Scientist',
    template: 'Aicser | %s',
  },
  icons: {
    icon: '/aicser_logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={{
        margin: 0,
        padding: 0,
        width: '100%',
        height: '100%',
        background: 'var(--ant-color-bg-layout, var(--color-bg-base))',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Khmer:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&family=Siemreap&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('darkMode');
                if (theme === 'true') {
                  document.documentElement.classList.add('dark');
                  document.documentElement.setAttribute('data-theme', 'dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          width: '100%',
          height: '100%',
          background: 'var(--ant-color-bg-layout, var(--color-bg-base))',
          backgroundColor: 'var(--ant-color-bg-layout, var(--color-bg-base))',
          color: 'var(--ant-color-text)',
          overflowX: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <GlobalErrorBoundary>
          <Providers>{children}</Providers>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
