import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aicser - AI Data Scientist',
    short_name: 'Aicser',
    description: 'AI-powered data analytics and visualization platform',
    start_url: '/chat',
    scope: '/',
    id: '/',
    display: 'standalone',
    display_override: ['standalone', 'browser'],
    orientation: 'any',
    background_color: '#0d1117',
    theme_color: '#00c2cb',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'AI Engine',
        short_name: 'Chat',
        url: '/chat',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Data Sources',
        short_name: 'Data',
        url: '/data',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
