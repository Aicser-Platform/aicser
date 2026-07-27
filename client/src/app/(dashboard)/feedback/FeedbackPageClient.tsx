'use client';

import dynamic from 'next/dynamic';
import { Spin } from 'antd';

function PageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Spin size="large" />
    </div>
  );
}

const EEFeedbackPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.FeedbackPage })),
  { ssr: false, loading: PageFallback },
);

export default function FeedbackPageClient() {
  return <EEFeedbackPage />;
}
