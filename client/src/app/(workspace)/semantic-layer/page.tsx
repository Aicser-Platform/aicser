'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useMemo } from 'react';
import nextDynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDataSources } from '@/hooks/useDataSources';
import { isSemanticModelEligible } from '@/utils/semanticEligibleSources';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

const SemanticWorkspace = nextDynamic(() => import('@/ee').then((m) => m.SemanticWorkspace), {
  ssr: false,
  loading: () => <AppLoadingIndicator variant="full" />,
});

const VIEWS = ['ide', 'workbook', 'lineage'] as const;
type WorkspaceView = (typeof VIEWS)[number];

function SemanticWorkspacePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dataSources, isLoading } = useDataSources(undefined, { allProjects: true });

  const eligibleSources = useMemo(
    () => dataSources.filter(isSemanticModelEligible),
    [dataSources]
  );
  const rawView = searchParams?.get('view') || '';
  const view: WorkspaceView = (VIEWS as readonly string[]).includes(rawView)
    ? (rawView as WorkspaceView)
    : 'workbook';
  const selectedId = searchParams?.get('source') || '';
  const selectedSource = eligibleSources.find((ds) => ds.id === selectedId);

  const setParams = useCallback(
    (nextView: string, nextSource: string) => {
      router.replace(
        `/semantic-layer?view=${encodeURIComponent(nextView)}&source=${encodeURIComponent(nextSource)}`
      );
    },
    [router]
  );

  useEffect(() => {
    if (!isLoading && !selectedSource && eligibleSources.length > 0) {
      setParams(view, eligibleSources[0].id);
    }
  }, [isLoading, selectedSource, eligibleSources, view, setParams]);

  if (isLoading || (!selectedSource && eligibleSources.length > 0)) {
    return <AppLoadingIndicator variant="full" />;
  }
  if (!selectedSource) {
    // No eligible sources: send the user to connect data.
    router.replace('/data');
    return null;
  }

  return (
    <SemanticWorkspace
      view={view}
      dataSourceId={selectedSource.id}
      dataSourceName={selectedSource.name}
      sources={eligibleSources.map((ds) => ({ id: ds.id, name: ds.name, type: ds.type }))}
      onViewChange={(v: string) => setParams(v, selectedSource.id)}
      onSourceChange={(id: string) => setParams(view, id)}
    />
  );
}

export default function SemanticWorkspacePage() {
  return (
    <Suspense fallback={<AppLoadingIndicator variant="full" />}>
      <SemanticWorkspacePageInner />
    </Suspense>
  );
}
