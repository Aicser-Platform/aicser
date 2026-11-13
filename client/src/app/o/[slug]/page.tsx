import { Suspense } from 'react';
import '@/app/globals.css';
import '@/styles/aicser-ui.css';
import '@/styles/office-fonts.css';
import '@/styles/docs.css';
import { OfficeLinkPage } from './OfficeLinkPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <OfficeLinkPage />
    </Suspense>
  );
}
