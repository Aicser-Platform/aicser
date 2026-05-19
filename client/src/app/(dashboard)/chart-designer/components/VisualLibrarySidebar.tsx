import React from 'react';
import { Typography, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { 
  LineChartOutlined, 
  BarChartOutlined, 
  PieChartFilled, 
  AreaChartOutlined,
  PlayCircleOutlined
} from '@ant-design/icons';
import './VisualLibrarySidebar.css';

interface VisualLibrarySidebarProps {
  onSelect: (template: any) => void;
  selectedType?: string;
}

export const VisualLibrarySidebar: React.FC<VisualLibrarySidebarProps> = ({ onSelect, selectedType }) => {
  const t = useTranslations('chart_designer');
  const widgetTemplates = [
    {
      id: 't-line',
      type: 'line',
      name: t('type_line'),
      icon: <LineChartOutlined />,
      category: t('category_visuals'),
      defaultSize: { w: 6, h: 5 },
      description: t('desc_line'),
    },
    {
      id: 't-bar',
      type: 'bar',
      name: t('type_bar'),
      icon: <BarChartOutlined />,
      category: t('category_visuals'),
      defaultSize: { w: 6, h: 5 },
      description: t('desc_bar'),
    },
    {
      id: 't-area',
      type: 'area',
      name: t('type_area'),
      icon: <AreaChartOutlined />,
      category: t('category_visuals'),
      defaultSize: { w: 6, h: 5 },
      description: t('desc_area'),
    },
    {
      id: 't-pie',
      type: 'pie',
      name: t('type_pie'),
      icon: <PieChartFilled />,
      category: t('category_visuals'),
      defaultSize: { w: 6, h: 5 },
      description: t('desc_pie'),
    },
    {
      id: 't-scatter',
      type: 'scatter',
      name: t('type_scatter'),
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M888 792H232V136c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v704c0 4.4 3.6 8 8 8h720c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM312 288c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm560 216c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zM544 192c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm176 416c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64z" />
        </svg>
      </div>
    ),
    category: t('category_visuals'),
    defaultSize: { w: 6, h: 5 },
    description: t('desc_scatter'),
  },
  {
    id: 't-heatmap',
    type: 'heatmap',
    name: t('type_heatmap'),
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h128v128H320V320zm256 0h128v128H576V320zM320 576h128v128H320V576zm256 0h128v128H576V576z" />
        </svg>
      </div>
    ),
    category: t('category_visuals'),
    defaultSize: { w: 6, h: 5 },
    description: t('desc_heatmap'),
  },
];
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
              <div className="library-item-icon">
                {template.icon}
              </div>
              <span className="library-item-name">{template.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
