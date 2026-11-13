import { Suspense } from 'react';
import type { Metadata } from 'next';
import '@/app/globals.css';
import '@/styles/aicser-ui.css';
import { PhoneRemote } from './PhoneRemote';

// The token is a key: keep the page out of search engines and referrers.
export const metadata: Metadata = {
  title: 'Slide show remote',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PhoneRemote />
    </Suspense>
  );
}
