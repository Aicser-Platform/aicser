'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WorkspaceBody } from '@/components/aicser-ui/page';
import { SemanticStudio } from '@/components/semantic-studio/SemanticStudio';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import { SEMANTIC_SECTIONS, type SemanticSection } from '@/lib/semantic/readiness';

export const dynamic = 'force-dynamic';

/** One connection's semantic model; `?section=` picks the tab (metrics | dimensions | joins | questions | try). */
export default function SemanticLayerSourcePage() {
  const t = useTranslations('semantic_studio');
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const sourceId = String(params?.id ?? '');
  const raw = search?.get('section') as SemanticSection | null;
  const section: SemanticSection = raw && SEMANTIC_SECTIONS.includes(raw) ? raw : 'metrics';

  return (
    <WorkspaceBody>
      {isEnterpriseEdition ? (
        <SemanticStudio key={sourceId} sourceId={sourceId} section={section} />
      ) : (
        <>
          <h1 className="m-0 text-xl font-semibold">{t('page_title')}</h1>
          <p className="m-0 text-sm text-muted-foreground">{t('ee_only')}</p>
        </>
      )}
    </WorkspaceBody>
  );
}
