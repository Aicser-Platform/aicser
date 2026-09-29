'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { NotebookEditor } from '../components/NotebookEditor';

export default function NotebookPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  return (
    <DashboardPageShell>
      <NotebookEditor key={id} notebookId={id} />
    </DashboardPageShell>
  );
}
