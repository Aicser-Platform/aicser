import React from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';

/** Pipelines are on Aicser UI (the desktop's design system). */
export default function PipelinesLayout({ children }: { children: React.ReactNode }) {
  return <AicserUi>{children}</AicserUi>;
}
