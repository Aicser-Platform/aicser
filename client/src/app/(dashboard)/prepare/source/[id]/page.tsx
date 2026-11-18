'use client';

import { useParams } from 'next/navigation';
import { PageBody } from '@/components/aicser-ui/page';
import { SourcePrepPage } from '@/components/prep/SourcePrepPage';

export const dynamic = 'force-dynamic';

/** Every table of one source: what to clean, its recipes, and the source's clean copy. */
export default function SourcePrepRoute() {
  const params = useParams<{ id: string }>();
  const sourceId = String(params?.id ?? '');
  return (
    <PageBody>
      <SourcePrepPage key={sourceId} sourceId={sourceId} />
    </PageBody>
  );
}
