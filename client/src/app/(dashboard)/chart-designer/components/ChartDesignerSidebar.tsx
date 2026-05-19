'use client';

import React, { useState } from 'react';
import { Input, Dropdown, Modal, Typography } from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  AreaChartOutlined,
  DotChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useChartDesignerStore } from '../stores/useChartDesignerStore';
import { WIDGET_TEMPLATES } from '../../dashboards/widgetTemplates';
import './ChartDesignerSidebar.css';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

const getChartIcon = (type: string) => {
  switch (type?.toLowerCase()) {
    case 'line':
      return <LineChartOutlined />;
    case 'bar':
      return <BarChartOutlined />;
    case 'pie':
      return <PieChartOutlined />;
    case 'donut':
      return (
        <div className="anticon">
          <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
            <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 672c-123.7 0-224-100.3-224-224s100.3-224 224-224 224 100.3 224 224-100.3 224-224 224z" />
          </svg>
        </div>
      );
    case 'area':
      return <AreaChartOutlined />;
    case 'scatter':
      return <DotChartOutlined />;
    case 'table':
      return <TableOutlined />;
    default:
      return <BarChartOutlined />;
  }
};

export const ChartDesignerSidebar: React.FC = () => {
  const t = useTranslations('chart_designer');
  const { widgets, selectedWidgetId, isSidebarCollapsed, setSelectedWidgetId, deleteChart, updateWidget, addWidget } =
    useChartDesignerStore();

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const filteredWidgets = widgets.filter((w) => w.title?.toLowerCase().includes(search.toLowerCase()));

  const handleRename = (id: string, title: string) => {
    setEditingId(id);
    setEditValue(title);
  };

  const submitRename = () => {
    if (editingId && editValue.trim()) {
      updateWidget(editingId, { title: editValue.trim() });
      setEditingId(null);
    }
  };

  const handleDelete = (id: string, title: string) => {
    Modal.confirm({
      title: t('delete_chart_title'),
      content: t('delete_chart_confirm', { title }),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: () => {
        deleteChart(id);
      },
    });
  };

  const handleAddNew = () => {
    // Default to bar chart template
    const template = WIDGET_TEMPLATES[1]; // Bar chart
    const newWidgetId = `w_designer_${Date.now()}`;

    addWidget(
      {
        id: newWidgetId,
        title: t('untitled_chart'),
        chartType: template.type,
        chartQuery: {},
        chartOptions: {},
        isLoading: false,
        error: null,
      },
      {
        i: newWidgetId,
        x: 0,
        y: 0,
        w: 4,
        h: 5,
      }
    );
  };

  const renderChartItem = (widget: (typeof filteredWidgets)[number]) => (
    <div
      key={widget.id}
      className={`nav-item ${selectedWidgetId === widget.id ? 'active' : ''}`}
      onClick={() => setSelectedWidgetId(widget.id)}
    >
      <div className="item-icon">{getChartIcon(widget.chartType)}</div>
      <div className="item-content">
        {editingId === widget.id ? (
          <Input
            size="small"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={submitRename}
            onPressEnter={submitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="item-name">{widget.title || t('untitled_short')}</span>
        )}
      </div>

      <Dropdown
        menu={{
          items: [
            {
              key: 'rename',
              icon: <EditOutlined />,
              label: t('rename'),
              onClick: () => handleRename(widget.id, widget.title),
            },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: t('delete'),
              danger: true,
              onClick: () => handleDelete(widget.id, widget.title),
            },
          ],
          onClick: (e) => e.domEvent.stopPropagation(),
        }}
        trigger={['click']}
        placement="bottomRight"
      >
        <div className="item-actions" onClick={(e) => e.stopPropagation()}>
          <MoreOutlined />
        </div>
      </Dropdown>
    </div>
  );

  const hasAnyItems = filteredWidgets.length > 0;

  return (
    <aside className={`chart-designer-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('search_placeholder_short')}
          variant="borderless"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="sidebar-nav">
        {!hasAnyItems && (
          <div className="empty-sidebar-state">
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {search ? t('empty_no_charts_search') : t('empty_no_charts')}
            </Text>
          </div>
        )}

        {filteredWidgets.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">{t('section_charts')}</div>
            <div className="nav-items-list">{filteredWidgets.map((widget) => renderChartItem(widget))}</div>
          </div>
        )}

        <div className="add-chart-item" onClick={handleAddNew}>
          <PlusOutlined className="item-icon" />
          <span className="item-name">{t('add_chart')}</span>
        </div>
      </div>
    </aside>
  );
};
