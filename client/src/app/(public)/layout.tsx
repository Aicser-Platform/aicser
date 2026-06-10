'use client';

import React from 'react';
import PublicShell from '@/components/layout/PublicShell';
import '@/components/layout/PublicShell.css';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
