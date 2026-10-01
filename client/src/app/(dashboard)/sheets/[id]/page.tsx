'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { Spin } from 'antd';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';

// The spreadsheet engine is WebAssembly and draws on a canvas: browser only.
const WorkbookEditor = dynamic(() => import('../components/WorkbookEditor').then((m) => m.WorkbookEditor), {
  ssr: false,
  loading: () => <div className="wb-loading"><Spin /></div>,
});

export default function WorkbookPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  return (
    <DashboardPageShell>
      <WorkbookEditor key={id} workbookId={id} />
    </DashboardPageShell>
  );
}
