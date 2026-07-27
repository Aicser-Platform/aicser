'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardPageLoading } from '@/components/layout/DashboardPageShell';

/** The per-source Studio moved into the /semantic-layer workbench; keep old links working. */
export default function SemanticWorkspaceRedirect() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    const id = String(params?.id || '');
    router.replace(
      id ? `/semantic-layer?source=${encodeURIComponent(id)}` : '/semantic-layer'
    );
  }, [params, router]);

  return <DashboardPageLoading />;
}
