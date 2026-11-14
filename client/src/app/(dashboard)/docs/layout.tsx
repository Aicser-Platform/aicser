import type { ReactNode } from 'react';
import { OfficeShell } from '@/components/office/OfficeShell';
import '@/styles/aicser-ui.css';
import '@/styles/office-fonts.css';
import '@/styles/docs.css';

export default function DocsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <OfficeShell>{children}</OfficeShell>;
}
