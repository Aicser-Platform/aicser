'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import PolicyEditorPage from '../../_components/policy/PolicyEditorPage';

export default function EditRowFilterPolicyPage() {
  const params = useParams();
  return (
    <PolicyEditorPage
      dataSourceId={String(params?.id || '')}
      policyId={String(params?.policyId || '')}
    />
  );
}
