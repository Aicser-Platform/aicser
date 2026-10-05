'use client';

import { useTranslations } from 'next-intl';
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

const SECTION_LABEL_KEYS: Record<SidebarSection, string> = {
  dashboards: 'rail_dashboards',
  charts: 'rail_charts',
  data: 'rail_data',
  modeling: 'rail_modeling',
  ai: 'rail_ai',
};

export function StudioSidebarPanel({
  activeSection,
  children,
  isFullPage,
  onCollapse,
}: StudioSidebarPanelProps) {
  const t = useTranslations('dashboards_page');
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
            <span className="studio-panel-header-label">{t(SECTION_LABEL_KEYS[activeSection] as never)}</span>
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
