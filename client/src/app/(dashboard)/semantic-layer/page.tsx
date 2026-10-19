'use client';

export const dynamic = 'force-dynamic';

import nextDynamic from 'next/dynamic';

const SemanticLayerHub = nextDynamic(
  () => import('@/components/semantic/SemanticLayerHub').then((m) => m.SemanticLayerHub),
  { ssr: false },
);

export default function SemanticLayerPage() {
  return <SemanticLayerHub />;
}
