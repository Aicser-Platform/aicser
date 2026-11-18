import React from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';

/** Shared insights pages are on Aicser UI (the desktop's design system): everything under /feed is in its scope. */
export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <AicserUi>{children}</AicserUi>;
}
