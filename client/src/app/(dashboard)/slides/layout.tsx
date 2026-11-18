import type { ReactNode } from 'react';
import { OfficeShell } from '@/components/office/OfficeShell';
import '@/styles/office-fonts.css';

export default function SlidesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <OfficeShell>{children}</OfficeShell>;
}
