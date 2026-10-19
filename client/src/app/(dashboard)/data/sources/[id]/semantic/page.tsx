'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { parseSemanticSectionParam, semanticLayerStudioHref } from '../_components/tabParam';
import { useSearchParams } from 'next/navigation';

/** Legacy route — workbench lives on the data source detail tab. */
export default function SemanticStudioRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dataSourceId = String(params?.id || '');

  useEffect(() => {
    if (dataSourceId) {
      const section = parseSemanticSectionParam(searchParams?.get('section') ?? null);
      router.replace(semanticLayerStudioHref(dataSourceId, section ?? undefined), { scroll: false });
    }
  }, [dataSourceId, router, searchParams]);

  return null;
}
