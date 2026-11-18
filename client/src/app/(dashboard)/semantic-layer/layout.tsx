import React from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';

/** Semantic models are on Aicser UI (the desktop's design system and its semantic model screens). */
export default function SemanticLayerLayout({ children }: { children: React.ReactNode }) {
  return <AicserUi>{children}</AicserUi>;
}
