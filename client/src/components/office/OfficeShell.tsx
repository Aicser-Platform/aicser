'use client';

import type { ReactNode } from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { TooltipProvider } from '@/components/aicser-ui/tooltip';

/** Docs and Slides pages: the Aicser UI scope (desktop design system), tooltips (toasts come from the app shell). */
export function OfficeShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AicserUi>
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </TooltipProvider>
    </AicserUi>
  );
}
