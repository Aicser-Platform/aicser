'use client';

import React, { useState } from 'react';
import { Input, Dropdown, Modal, Typography, Select, message } from 'antd';
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
  DashboardOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useChartDesignerStore } from '../stores/useChartDesignerStore';
import { useDashboardStore } from '../../dashboards/stores/useDashboardStore';
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
  const router = useRouter();
  const { widgets, selectedWidgetId, isSidebarCollapsed, setSelectedWidgetId, deleteChart, updateWidget } =
    useChartDesignerStore();
  const dashboards = useDashboardStore((s) => s.dashboards);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const copyWidgetToDashboard = useDashboardStore((s) => s.copyWidgetToDashboard);

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);
  const [addToDashboardWidgetId, setAddToDashboardWidgetId] = useState<string | null>(null);
  const [targetDashboardId, setTargetDashboardId] = useState<string | null>(null);
  const [addingToDashboard, setAddingToDashboard] = useState(false);

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

  const openAddToDashboard = async (widgetId: string) => {
    if (dashboards.length === 0) {
      try {
        await fetchDashboards();
      } catch {
        message.error(t('add_to_dashboard_load_failed'));
        return;
      }
    }
    setAddToDashboardWidgetId(widgetId);
    setTargetDashboardId(useDashboardStore.getState().activeDashboardId ?? dashboards[0]?.id ?? null);
    setAddToDashboardOpen(true);
  };

  const handleAddToDashboard = async () => {
    const widget = widgets.find((w) => w.id === addToDashboardWidgetId);
    if (!widget?.chartId || !targetDashboardId) {
      message.warning(t('add_to_dashboard_select_required'));
      return;
    }
    setAddingToDashboard(true);
    try {
      const result = await copyWidgetToDashboard(widget as unknown as Parameters<typeof copyWidgetToDashboard>[0], { i: widget.id, x: 0, y: 0, w: 6, h: 5 }, targetDashboardId);
      message.success(t('add_to_dashboard_success'));
      setAddToDashboardOpen(false);
      router.push(`/dashboards?id=${targetDashboardId}&chart=${result.chartId}`);
    } catch (err) {
      console.error('[ChartDesignerSidebar] add to dashboard', err);
      message.error(t('add_to_dashboard_failed'));
    } finally {
      setAddingToDashboard(false);
    }
  };

  const handleAddNew = () => {
    // Deselecting (rather than creating a widget with a hardcoded type)
    // falls back to ChartDesignerStudio's EmptyDesignerState, which shows
    // the same chart-type picker used for the very first chart.
    setSelectedWidgetId(null);
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
            ...(widget.chartId
              ? [
                  {
                    key: 'add-to-dashboard',
                    icon: <DashboardOutlined />,
                    label: t('add_to_dashboard'),
                    onClick: () => void openAddToDashboard(widget.id),
                  },
                ]
              : []),
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

      <Modal
        title={t('add_to_dashboard')}
        open={addToDashboardOpen}
        onCancel={() => setAddToDashboardOpen(false)}
        onOk={() => void handleAddToDashboard()}
        okText={t('add_to_dashboard_confirm')}
        confirmLoading={addingToDashboard}
      >
        <Select
          style={{ width: '100%' }}
          placeholder={t('add_to_dashboard_select')}
          value={targetDashboardId ?? undefined}
          onChange={setTargetDashboardId}
          options={dashboards.map((d) => ({ value: d.id, label: d.name }))}
        />
      </Modal>
    </aside>
  );
};
