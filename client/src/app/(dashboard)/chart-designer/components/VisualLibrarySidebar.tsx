'use client';

import React, { useMemo } from 'react';
import { Typography, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { CHART_WIDGET_TEMPLATES } from '../../dashboards/widgetTemplates';
import { localizeWidgetTemplate } from '../../dashboards/utils/localizeWidgetTemplate';
import './VisualLibrarySidebar.css';

interface VisualLibrarySidebarProps {
  onSelect: (template: unknown) => void;
  selectedType?: string;
}

/** Chart designer visual library — same switchable catalog as Build / Add Block. */
export const VisualLibrarySidebar: React.FC<VisualLibrarySidebarProps> = ({
  onSelect,
  selectedType,
}) => {
  const t = useTranslations('chart_designer');
  const widgetTemplates = useMemo(
    () => CHART_WIDGET_TEMPLATES.map((item) => localizeWidgetTemplate(item, t as never)),
    [t],
  );

  return (
    <aside className="visual-library-sidebar">
      <div className="sidebar-header">
        <span className="header-title">{t('category_visuals')}</span>
      </div>
      <div className="library-grid-container">
        <div className="library-grid">
          {widgetTemplates.map((template) => (
            <div
              key={template.id}
              className={`library-item-card ${selectedType === template.type ? 'active' : ''}`}
              onClick={() => onSelect(template)}
            >
              <Tooltip title={template.description}>
                <div className="library-item-icon">{template.icon}</div>
              </Tooltip>
              <Typography.Text className="library-item-name" ellipsis>
                {template.name}
              </Typography.Text>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default VisualLibrarySidebar;
