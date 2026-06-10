export const dynamic = 'force-dynamic';

import { GOOGLE_FONTS_HREF } from '@/config/typography';
import { Providers } from '@/components/Providers/Providers';
import GlobalErrorBoundary from '@/components/layout/GlobalErrorBoundary';
import { SerwistProvider } from '@/components/pwa/SerwistProvider';
import { Metadata, Viewport } from 'next';

const APP_NAME = 'Aicser';
const APP_DESCRIPTION = 'AI-powered data analytics and visualization platform';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: 'Aicser - AI Data Scientist',
    template: 'Aicser | %s',
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
  colorScheme: 'light dark',
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
        <link href={GOOGLE_FONTS_HREF} rel="stylesheet" />
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
          <SerwistProvider>
            <Providers>{children}</Providers>
          </SerwistProvider>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
