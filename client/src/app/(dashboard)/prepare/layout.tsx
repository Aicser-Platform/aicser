import React from 'react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { PrepI18n } from '@/lib/prep/i18n';

/** Prepare is on Aicser UI (the desktop's design system and its Prepare screens). */
export default function PrepareLayout({ children }: { children: React.ReactNode }) {
  return (
    <AicserUi>
      <PrepI18n>{children}</PrepI18n>
    </AicserUi>
  );
}
