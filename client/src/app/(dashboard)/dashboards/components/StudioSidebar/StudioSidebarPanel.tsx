'use client';

import React from 'react';
import type { SidebarSection } from './StudioSidebarRail';
import './StudioSidebar.css';

interface StudioSidebarPanelProps {
  activeSection: SidebarSection | null;
  children: React.ReactNode;
  isFullPage?: boolean;
}

const SECTION_LABELS: Record<SidebarSection, string> = {
  dashboards: 'Dashboards',
  data: 'Data',
  modeling: 'Data Modeling',
};

export function StudioSidebarPanel({ activeSection, children, isFullPage }: StudioSidebarPanelProps) {
  const isOpen = activeSection !== null;
  const cls = [
    'studio-sidebar-panel',
    !isOpen && 'collapsed',
    isOpen && isFullPage && 'full-page',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {isOpen && (
        <>
          <div className="studio-panel-header">{SECTION_LABELS[activeSection]}</div>
          <div className="studio-panel-body">{children}</div>
        </>
      )}
    </div>
  );
}
