'use client';

import React, { useState } from 'react';
import { Button, Typography, Dropdown, message, Input } from 'antd';
import { useRouter, usePathname } from 'next/navigation';
import { Responsive, WidthProvider } from 'react-grid-layout';
import {
  DeleteOutlined,
  MoreOutlined,
  CopyOutlined,
  FileImageOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  SettingOutlined,
  LineChartOutlined,
  AreaChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import { WidgetPreview } from '../widgets/WidgetPreview';
import { exportChartByWidget } from '../services/exportChartImageService';
import { exportCSV } from '../services/exportChartDataService';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useTranslations } from 'next-intl';

const { Text } = Typography;
const ResponsiveGridLayout = WidthProvider(Responsive);

const WIDGET_SECTIONS = [
  {
    title: 'Charts',
    items: [
      {
        id: 't-line',
        type: 'line',
        name: 'Line',
        icon: <LineChartOutlined />,
        defaultSize: { w: 6, h: 5 },
        description: 'Line chart using sample data for layout verification.',
      },
      {
        id: 't-bar',
        type: 'bar',
        name: 'Bar',
        icon: <BarChartOutlined rotate={90} />,
        defaultSize: { w: 6, h: 5 },
        description: 'Bar chart for comparing categories and discrete values.',
      },
      {
        id: 't-area',
        type: 'area',
        name: 'Area',
        icon: <AreaChartOutlined />,
        defaultSize: { w: 6, h: 5 },
        description: 'Area chart for showing trends over time.',
      },
      {
        id: 't-pie',
        type: 'pie',
        name: 'Pie',
        icon: <PieChartOutlined />,
        defaultSize: { w: 6, h: 5 },
        description: 'Pie chart with stubbed data; useful to test chart slots.',
      },
      {
        id: 't-scatter',
        type: 'scatter',
        name: 'Scatter',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M888 792H232V136c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v704c0 4.4 3.6 8 8 8h720c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM312 288c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm560 216c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zM544 192c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm176 416c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64z" />
            </svg>
          </div>
        ),
        defaultSize: { w: 6, h: 5 },
        description: 'Scatter plot for showing correlation between two variables.',
      },
      {
        id: 't-heatmap',
        type: 'heatmap',
        name: 'Heatmap',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h128v128H320V320zm256 0h128v128H576V320zM320 576h128v128H320V576zm256 0h128v128H576V576z" />
            </svg>
          </div>
        ),
        defaultSize: { w: 6, h: 5 },
        description: 'Heatmap to visualize data density.',
      },
    ],
  },
  {
    title: 'Data',
    items: [
      {
        id: 't-table',
        type: 'table',
        name: 'Table',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M912 192H112c-8.8 0-16 7.2-16 16v560c0 8.8 7.2 16 16 16h800c8.8 0 16-7.2 16-16V208c0-8.8-7.2-16-16-16zM656 256v160H368V256h288zM368 480h288v160H368V480zM160 256h144v160H160V256zm0 224h144v160H160V480zm0 304v-80h144v80H160zm208 0v-80h288v80H368zm496 0H720v-80h144v80zm0-144H720V480h144v160zm0-224H720V256h144v160z" />
            </svg>
          </div>
        ),
        defaultSize: { w: 8, h: 6 },
        description: 'Table widget to display raw data.',
      },
    ],
  },
  {
    title: 'Content',
    items: [
      {
        id: 't-text',
        type: 'text',
        name: 'Text Block',
        icon: (
          <div className="anticon">
            <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
              <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h384v64H320V320zm0 192h384v64H320V512zm0 192h256v64H320V704z" />
            </svg>
          </div>
        ),
        defaultSize: { w: 4, h: 3 },
        description: 'Add text notes or descriptions.',
      },
    ],
  },
];

export default function DashboardCanvas({
  widgets,
  layout,
  selectedWidgetId,
  setSelectedWidgetId,
  setLayout,
  removeWidget,
  duplicateWidget,
  onAddWidget,
  onDropWidget,
  setPropertiesCollapsed,
  onUpdateWidget,
  onLayoutSync,
}: {
  widgets: any[];
  layout: any[];
  selectedWidgetId: string | null;
  setSelectedWidgetId: (id: string | null) => void;
  setLayout: (l: any[]) => void;
  removeWidget: (id: string) => void;
  duplicateWidget?: (id: string) => void;
  onAddWidget: (template?: any) => void;
  onDropWidget?: (template: any) => void;
  setPropertiesCollapsed: (collapsed: boolean) => void;
  onUpdateWidget?: (id: string, updates: any) => void;
  onLayoutSync?: (l: any[]) => void;
}) {
  const t = useTranslations('dashboards_page');
  const router = useRouter();
  const pathname = usePathname();
  const isDesigner = pathname?.includes('chart-designer');

  const [isDragOver, setIsDragOver] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const [designerRowHeight, setDesignerRowHeight] = useState(40);

  React.useEffect(() => {
    if (!isDesigner) return;
    const updateHeight = () => {
      const vh = window.innerHeight;
      const availableHeight = vh - 110; 
      const rows = 24; // Matched with DESIGNER_DEFAULT_CHART_HEIGHT
      setDesignerRowHeight(Math.max(26, Math.floor(availableHeight / rows)));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [isDesigner]);

  const localizeTemplate = (item: any) => {
    const byType: Record<string, { name: string; description: string }> = {
      line: { name: t('type_line_short'), description: t('desc_line') },
      bar: { name: t('type_bar_short'), description: t('desc_bar') },
      area: { name: t('type_area_short'), description: t('desc_area') },
      pie: { name: t('type_pie_short'), description: t('desc_pie') },
      scatter: { name: t('type_scatter_short'), description: t('desc_scatter') },
      heatmap: { name: t('type_heatmap_short'), description: t('desc_heatmap') },
    };
    const translated = byType[item.type];
    return translated ? { ...item, ...translated } : item;
  };
  
  const { dashboards, fetchDashboards, activeDashboardId, setActiveDashboardId, copyWidgetToDashboard } = useDashboardStore();

  React.useEffect(() => {
    if (dashboards.length === 0) {
      fetchDashboards();
    }
  }, [dashboards.length, fetchDashboards]);

  const handleCopyToDashboard = async (targetDashboardId: string, widget: any) => {
    try {
      // Find current layout for this widget
      const layoutItem = layout.find((l) => l.i === widget.id);
      
      // Use the optimistic store action — no full re-fetch, no UI disruption
      await copyWidgetToDashboard(widget, layoutItem, targetDashboardId);
      message.success('Widget copied to dashboard successfully');

      if (isDesigner) {
        router.push('/dashboards');
      }
    } catch (error) {
      console.error('Failed to copy widget:', error);
      message.error('Failed to copy widget to dashboard');
    }
  };

  const handleMenuClick = (key: string, widgetId: string) => {
    const widget = widgets.find((w) => w.id === widgetId);

    if (!widget) {
      console.error('Widget not found for CSV export');
      return;
    }

    switch (key) {
      case 'duplicate':
        duplicateWidget?.(widgetId);
        break;

      case 'export-csv':
        try {
          exportCSV(widget.chartData, widget.title || 'chart-data', widget);
          message.success('CSV exported successfully');
        } catch (error) {
          message.error('Failed to export CSV: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
        break;

      case 'export-excel':
        console.log('Export Excel', widgetId);
        break;

      case 'export-png':
        exportChartByWidget(widgetId, widget?.title, 'png');
        break;

      case 'export-svg':
        exportChartByWidget(widgetId, widget?.title, 'svg');
        break;

      case 'delete':
        if (confirm('Are you sure you want to delete this widget?')) removeWidget(widgetId);
        break;

      case 'configure':
        setPropertiesCollapsed(false);
        break;

      default:
        if (key.startsWith('copy-to-')) {
          const targetDashboardId = key.replace('copy-to-', '');
          handleCopyToDashboard(targetDashboardId, widget);
        }
        break;
    }
  };

  const getMenuItems = () => [
    {
      key: 'configure',
      label: 'Configure',
      icon: <SettingOutlined />,
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: <CopyOutlined />,
    },
    {
      key: 'copy-to-dashboard',
      label: 'Copy to Dashboard',
      icon: <CopyOutlined />,
      children: dashboards.length > 0 
        ? dashboards.map((d) => ({
            key: `copy-to-${d.id}`,
            label: d.name || 'Untitled Dashboard',
          }))
        : [{ key: 'no-dashboards', label: 'No dashboards found', disabled: true }],
    },
    {
      key: 'export-data',
      label: 'Export Data',
      icon: <FileExcelOutlined />,
      children: [
        { key: 'export-csv', label: 'Export CSV', icon: <FileTextOutlined /> },
        { key: 'export-excel', label: 'Export Excel', icon: <FileExcelOutlined /> },
      ],
    },
    {
      key: 'export-image',
      label: 'Export Image',
      icon: <FileImageOutlined />,
      children: [
        { key: 'export-png', label: 'Export PNG' },
        { key: 'export-svg', label: 'Export SVG' },
      ],
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      label: 'Delete',
      icon: <DeleteOutlined />,
      danger: true,
    },
  ];

  const startEditing = (widget: any) => {
    setEditingWidgetId(widget.id);
    setTempTitle(widget.title);
  };

  const saveTitle = () => {
    if (editingWidgetId && onUpdateWidget) {
      onUpdateWidget(editingWidgetId, { title: tempTitle });
    }
    setEditingWidgetId(null);
  };

  return (
    <div
      className={`dashboard-container ${isDragOver ? 'drag-over' : ''}`}
      onClick={() => {
        if (!isDesigner) {
          setSelectedWidgetId(null);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        try {
          const data = e.dataTransfer.getData('application/json');
          if (data) onDropWidget?.(JSON.parse(data));
        } catch (err) {
          console.error(err);
        }
      }}
    >
      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={isDesigner ? { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 } : { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={isDesigner ? designerRowHeight : 42}
        margin={isDesigner ? [0, 0] : [8, 8]}
        containerPadding={[0, 0]}
        isDraggable={!isDesigner}
        onLayoutChange={(l) => setLayout(l)}
        onDragStop={(l) => onLayoutSync?.(l)}
        onResizeStop={(l) => onLayoutSync?.(l)}
        draggableHandle=".widget-card-header, .drag-handle"
        draggableCancel=".no-drag"
      >
        {widgets.map((w) => {
          const isText = w.chartType === 'text';
          const hasTitle = w.title && w.title.trim() !== '';
          const isSelected = selectedWidgetId === w.id;
          const showHeader = !isText || hasTitle || isSelected;

          return (
            <div key={w.id}>
              <div
                className={`widget-card ${isSelected ? 'selected' : ''} widget-type-${w.chartType} ${!showHeader ? 'header-hidden' : ''} ${w.chartOptions?.backgroundColor === 'transparent' ? 'is-transparent' : ''}`}
                data-widget-id={w.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWidgetId(w.id);
                  setPropertiesCollapsed(false);
                }}
                style={{
                  backgroundColor: w.chartOptions?.backgroundColor || undefined,
                }}
              >
                <div className="widget-card-header" style={{ display: showHeader ? 'flex' : 'none' }}>
                  {editingWidgetId === w.id ? (
                    <Input
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      onBlur={saveTitle}
                      onPressEnter={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingWidgetId(null);
                      }}
                      autoFocus
                      className="no-drag widget-title-input"
                      onClick={(e) => e.stopPropagation()}
                      size="small"
                      style={{ width: '100%', fontSize: '14px' }}
                    />
                  ) : (
                    <Text
                      className="widget-card-title no-drag"
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startEditing(w);
                      }}
                      title="Double click to edit title"
                      style={{
                        cursor: 'pointer',
                        userSelect: 'none',
                        fontWeight: w.chartOptions?.titleFontWeight || '700',
                        color: w.chartOptions?.titleColor || undefined,
                      }}
                    >
                      {w.title}
                    </Text>
                  )}

                  {selectedWidgetId === w.id && !editingWidgetId && (
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      menu={{
                        items: getMenuItems(),
                        onClick: ({ key }) => handleMenuClick(key, w.id),
                      }}
                    >
                      <Button
                        type="text"
                        size="small"
                        className="no-drag"
                        icon={<MoreOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  )}
                </div>

                {/* Refined Drag Handle - Middle and Horizontal */}
                <div className="drag-handle-icon drag-handle middle-top">
                  <HolderOutlined rotate={90} />
                </div>

              <div className={`widget-card-body ${isText && !showHeader ? 'drag-handle' : 'no-drag'}`}>
                <WidgetPreview
                  widget={w}
                  onUpdateConfig={(updates) =>
                    onUpdateWidget?.(w.id, { chartOptions: { ...(w.chartOptions || {}), ...updates } })
                  }
                  isDesigner={isDesigner}
                  isSelected={selectedWidgetId === w.id}
                />
              </div>
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>

      {widgets.length === 0 && (
        <div className="canvas-empty">
          <div className="canvas-empty-content">
            <div style={{ marginBottom: 32, textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 18, opacity: 0.8 }}>
                Start by choosing a widget to add to your dashboard
              </Text>
            </div>

            <div className="widget-selection-grid">
              {WIDGET_SECTIONS.find((s) => s.title === 'Charts')?.items.map((item) => {
                const localized = localizeTemplate(item);
                return (
                <div key={item.id} onClick={() => onAddWidget(localized)} className="widget-template-item">
                  <div className="widget-template-icon">{item.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="widget-template-title">{localized.name}</div>
                    <div className="widget-template-description">{localized.description}</div>
                  </div>
                </div>
              )})}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
