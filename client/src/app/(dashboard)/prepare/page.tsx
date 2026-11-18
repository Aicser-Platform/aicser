'use client';

import { PageBody } from '@/components/aicser-ui/page';
import { PreparePage } from '@/components/prep/PreparePage';

export const dynamic = 'force-dynamic';

export default function PrepareRoute() {
  return (
    <PageBody>
      <PreparePage />
    </PageBody>
  );
}
