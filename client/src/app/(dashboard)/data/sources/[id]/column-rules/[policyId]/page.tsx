'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import ColumnPolicyEditorPage from '../../_components/policy/ColumnPolicyEditorPage';

export default function EditColumnPolicyPage() {
  const params = useParams();
  return (
    <ColumnPolicyEditorPage
      dataSourceId={String(params?.id || '')}
      policyId={String(params?.policyId || '')}
    />
  );
}
