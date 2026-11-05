'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Documents now live on Connections (/data › Documents); older links keep their parameters. */
export default function KnowledgeRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? '');
    const panel = next.get('tab');
    if (panel && panel !== 'documents') next.set('section', panel); // which panel to open (search, connectors)
    next.set('tab', 'documents');
    router.replace(`/data?${next.toString()}`);
  }, [params, router]);
  return null;
}
