'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/constants/permissions';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEAIAnalyticsPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.AIAnalyticsPage })),
  { ssr: false }
);

export default function AIAnalyticsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!isEE) router.replace('/dashboards');
  }, [router]);

  if (!isEE) {
    return <Spin style={{ margin: 48 }} />;
  }

  return (
    <PermissionGuard permission={Permission.AI_USE} fallback={<Spin style={{ margin: 48 }} />}>
      <EEAIAnalyticsPage />
    </PermissionGuard>
  );
}
