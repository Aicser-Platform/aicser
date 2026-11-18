'use client';

import { useTranslations } from 'next-intl';
import { PageBody } from '@/components/aicser-ui/page';
import { SemanticHub } from '@/components/semantic-studio/SemanticHub';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';

export const dynamic = 'force-dynamic';

/** Semantic models: every connection's model and how ready it is (Enterprise server API). */
export default function SemanticLayerPage() {
  const t = useTranslations('semantic_studio');
  return (
    <PageBody>
      {isEnterpriseEdition ? (
        <SemanticHub />
      ) : (
        <>
          <h1 className="m-0 text-xl font-semibold">{t('page_title')}</h1>
          <p className="m-0 text-sm text-muted-foreground">{t('ee_only')}</p>
        </>
      )}
    </PageBody>
  );
}
