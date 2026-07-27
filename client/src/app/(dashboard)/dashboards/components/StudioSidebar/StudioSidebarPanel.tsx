'use client';

import React from 'react';
import { Button, Tooltip } from 'antd';
import { MenuFoldOutlined } from '@ant-design/icons';
import type { SidebarSection } from './StudioSidebarRail';
import './StudioSidebar.css';

interface StudioSidebarPanelProps {
  activeSection: SidebarSection | null;
  children: React.ReactNode;
  isFullPage?: boolean;
  onCollapse?: () => void;
}

const SECTION_LABELS: Record<SidebarSection, string> = {
  dashboards: 'Dashboards',
  data: 'Data',
  modeling: 'Data Modeling',
};

export function StudioSidebarPanel({
  activeSection,
  children,
  isFullPage,
  onCollapse,
}: StudioSidebarPanelProps) {
  const isOpen = activeSection !== null;
  const cls = [
    'studio-sidebar-panel',
    !isOpen && 'collapsed',
    isOpen && isFullPage && 'full-page',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      {isOpen && (
        <>
          <div className="studio-panel-header">
            <span className="studio-panel-header-label">{SECTION_LABELS[activeSection]}</span>
            {onCollapse ? (
              <Tooltip title="Collapse panel" placement="bottom">
                <Button
                  type="text"
                  size="small"
                  className="studio-panel-collapse-btn"
                  icon={<MenuFoldOutlined />}
                  aria-label="Collapse panel"
                  onClick={onCollapse}
                />
              </Tooltip>
            ) : null}
          </div>
          <div className="studio-panel-body">{children}</div>
        </>
      )}
    </div>
  );
}
