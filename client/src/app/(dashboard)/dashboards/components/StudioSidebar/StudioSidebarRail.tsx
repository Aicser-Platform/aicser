'use client';

import React from 'react';
import { Tooltip } from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import './StudioSidebar.css';

export type SidebarSection = 'dashboards' | 'data' | 'modeling';

interface StudioSidebarRailProps {
  activeSection: SidebarSection | null;
  onSectionChange: (section: SidebarSection | null) => void;
}

export function StudioSidebarRail({ activeSection, onSectionChange }: StudioSidebarRailProps) {
  const t = useTranslations('dashboards_page');
  const sections: { key: SidebarSection; icon: React.ReactNode; label: string }[] = [
    { key: 'dashboards', icon: <AppstoreOutlined />, label: t('rail_dashboards') },
    { key: 'data', icon: <DatabaseOutlined />, label: t('rail_data') },
    { key: 'modeling', icon: <ApartmentOutlined />, label: t('rail_modeling') },
  ];

  return (
    <div className="studio-sidebar-rail">
      {sections.map(({ key, icon, label }) => (
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
