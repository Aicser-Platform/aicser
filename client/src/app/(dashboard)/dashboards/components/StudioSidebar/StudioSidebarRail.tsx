'use client';

import React from 'react';
import { Tooltip } from 'antd';
import {
  AppstoreOutlined,
  PlusSquareOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import './StudioSidebar.css';

export type SidebarSection = 'dashboards' | 'data' | 'modeling';

const SECTIONS: { key: SidebarSection; icon: React.ReactNode; label: string }[] = [
  { key: 'dashboards', icon: <AppstoreOutlined />, label: 'Dashboards' },
  { key: 'data', icon: <DatabaseOutlined />, label: 'Data' },
  { key: 'modeling', icon: <ApartmentOutlined />, label: 'Data Modeling' },
];

interface StudioSidebarRailProps {
  activeSection: SidebarSection | null;
  onSectionChange: (section: SidebarSection | null) => void;
}

export function StudioSidebarRail({ activeSection, onSectionChange }: StudioSidebarRailProps) {
  return (
    <div className="studio-sidebar-rail">
      {SECTIONS.map(({ key, icon, label }) => (
        <Tooltip key={key} title={label} placement="right" mouseEnterDelay={0.4}>
          <button
            className={`studio-rail-btn${activeSection === key ? ' active' : ''}`}
            onClick={() => onSectionChange(activeSection === key ? null : key)}
            aria-label={label}
            aria-pressed={activeSection === key}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
