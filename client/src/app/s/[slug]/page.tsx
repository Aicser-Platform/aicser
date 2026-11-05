import { Suspense } from 'react';
import '@/app/globals.css';
import { ShareLinkPage } from './ShareLinkPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShareLinkPage />
    </Suspense>
  );
}
