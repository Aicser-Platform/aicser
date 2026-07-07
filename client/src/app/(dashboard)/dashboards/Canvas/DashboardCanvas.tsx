'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Typography, Dropdown, message, Input, Tooltip, Modal } from 'antd';
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
  HolderOutlined,
  FilterOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  RobotOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { ExplainChartDrawer } from '../components/ExplainChartDrawer';
import { DashboardWidgetCell } from '../components/DashboardWidgetCell';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { getCrossFilterValues } from '../utils/filterOperators';
import { shouldShowWidgetHeader } from '../utils/widgetCardHelpers';
import { isLayoutSlotWidget } from '../utils/layoutScaffolds';
import '../components/AddDashboardDrawer.css';
import { WidgetBlockPicker } from '../components/WidgetBlockPicker';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { exportChartByWidget } from '../services/exportChartImageService';
import { exportCSV, exportExcel } from '../services/exportChartDataService';
import { useDashboardStore, useUndo, useRedo } from '../stores/useDashboardStore';
import { useTranslations } from 'next-intl';

const { Text } = Typography;
const ResponsiveGridLayout = WidthProvider(Responsive);

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
  dashboardId,
  runtimeFilters = [],
  onCrossFilter,
  onWidgetChartClick,
  onPageLayoutChange,
  readOnly = false,
  pages = [],
  onMoveWidgetToPage,
  peerEditingWidgetId = null,
  onCollabCursorMove,
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
  dashboardId?: string;
  runtimeFilters?: RuntimeFilter[];
  onCrossFilter?: (field: string, value: unknown) => void;
  onWidgetChartClick?: (
    widget: (typeof widgets)[number],
    field: string,
    value: unknown,
    shiftKey: boolean
  ) => void;
  onPageLayoutChange?: (l: any[]) => void;
  readOnly?: boolean;
  pages?: { id: string; name: string }[];
  onMoveWidgetToPage?: (widgetId: string, pageId: string) => void | Promise<void>;
  peerEditingWidgetId?: string | null;
  onCollabCursorMove?: (x: number, y: number, widgetId?: string | null) => void;
}) {
  const td = useTranslations('dashboards');
  const router = useRouter();
  const pathname = usePathname();
  const isDesigner = pathname?.includes('chart-designer');
  const isEditing = !readOnly && !isDesigner;

  const widgetById = useMemo(() => {
    return new Map(widgets.map((widget) => [widget.id, widget]));
  }, [widgets]);

  const cleanLayout = useCallback((nextLayout: any[]) => {
    return nextLayout.map(({ static: _static, moved: _moved, ...item }) => ({ ...item }));
  }, []);

  const commitLayout = useCallback(
    (nextLayout: any[], options?: { sync?: boolean }) => {
      const cleanedLayout = cleanLayout(nextLayout);

      if (onPageLayoutChange) {
        onPageLayoutChange(cleanedLayout);
      } else {
        setLayout(cleanedLayout);
      }

      if (options?.sync) {
        onLayoutSync?.(cleanedLayout);
      }

      return cleanedLayout;
    },
    [cleanLayout, onLayoutSync, onPageLayoutChange, setLayout]
  );

  const canvasZoom = useDashboardStore((s) => s.canvasZoom);
  const setCanvasZoom = useDashboardStore((s) => s.setCanvasZoom);
  const ZOOM_STEPS_CANVAS = [25, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

  // Multi-widget selection
  const selectedWidgetIds = useDashboardStore((s) => s.selectedWidgetIds);
  const toggleWidgetInSelection = useDashboardStore((s) => s.toggleWidgetInSelection);
  const clearMultiSelection = useDashboardStore((s) => s.clearMultiSelection);
  const bulkDeleteWidgets = useDashboardStore((s) => s.bulkDeleteWidgets);

  // Undo / redo
  const undo = useUndo();
  const redo = useRedo();

  const [isDragOver, setIsDragOver] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const [designerRowHeight, setDesignerRowHeight] = useState(40);
  const [focusedWidgetId, setFocusedWidgetId] = useState<string | null>(null);
  const [explainWidgetId, setExplainWidgetId] = useState<string | null>(null);

  const handleFocusWidget = useCallback((widgetId: string) => {
    setFocusedWidgetId(widgetId);
  }, []);

  const handleExitFocus = useCallback(() => {
    setFocusedWidgetId(null);
  }, []);

  useEffect(() => {
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

  // ─── Global canvas keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    if (readOnly) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing inside an input, textarea or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.ant-select') ||
        target.closest('.ant-input') ||
        target.closest('.tiptap') ||
        target.closest('[data-gramm]')
      ) {
        return;
      }

      // Escape — exit focus mode or deselect widget
      if (e.key === 'Escape') {
        if (focusedWidgetId) {
          setFocusedWidgetId(null);
          return;
        }
        setSelectedWidgetId(null);
        return;
      }

      // Delete / Backspace — remove selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidgetId) {
        e.preventDefault();
        const widget = widgets.find((w) => w.id === selectedWidgetId);
        const widgetTitle = widget?.title || 'this widget';
        Modal.confirm({
          title: td('delete_widget_confirm_title') || 'Delete widget?',
          content: td('delete_widget_confirm_body') || `Remove "${widgetTitle}"? This cannot be undone.`,
          okButtonProps: { danger: true },
          okText: td('delete_widget') || 'Delete',
          onOk: () => removeWidget(selectedWidgetId),
        });
        return;
      }

      // Ctrl/Cmd+Z — undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo?.();
        return;
      }

      // Ctrl/Cmd+Y or Ctrl+Shift+Z — redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo?.();
        return;
      }

      // Ctrl/Cmd+D — duplicate widget
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedWidgetId) {
        e.preventDefault();
        duplicateWidget?.(selectedWidgetId);
        return;
      }

      // Ctrl/Cmd+Enter — expand/focus widget
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedWidgetId) {
        e.preventDefault();
        setFocusedWidgetId(selectedWidgetId);
        return;
      }

      // Ctrl/Cmd+= or Ctrl/Cmd++ — zoom in
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const next = ZOOM_STEPS_CANVAS.find((z) => z > canvasZoom);
        if (next) setCanvasZoom(next);
        return;
      }

      // Ctrl/Cmd+- — zoom out
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const next = [...ZOOM_STEPS_CANVAS].reverse().find((z) => z < canvasZoom);
        if (next) setCanvasZoom(next);
        return;
      }

      // Ctrl/Cmd+0 — reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setCanvasZoom(100);
        return;
      }

      // Arrow keys — nudge selected widget by one grid unit
      if (selectedWidgetId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const itemIdx = layout.findIndex((l) => l.i === selectedWidgetId);
        if (itemIdx < 0) return;
        const item = layout[itemIdx];
        if (!item) return;
        let { x, y } = item;
        if (e.key === 'ArrowLeft') x = Math.max(0, x - 1);
        if (e.key === 'ArrowRight') x = Math.min(11, x + 1);
        if (e.key === 'ArrowUp') y = Math.max(0, y - 1);
        if (e.key === 'ArrowDown') y = y + 1;
        const next = [...layout];
        next[itemIdx] = { ...item, x, y };
        commitLayout(next, { sync: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, selectedWidgetId, focusedWidgetId, widgets, removeWidget, duplicateWidget, setSelectedWidgetId, td, undo, redo, canvasZoom, setCanvasZoom, layout, commitLayout]);

  const { dashboards, fetchDashboards, activeDashboardId, setActiveDashboardId, copyWidgetToDashboard } = useDashboardStore();

  useEffect(() => {
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
        try {
          exportExcel(widget.chartData, widget.title || 'chart-data', widget);
          message.success('Excel exported successfully');
        } catch (error) {
          message.error('Failed to export Excel: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
        break;

      case 'export-png':
        exportChartByWidget(widgetId, widget?.title, 'png');
        break;

      case 'export-svg':
        exportChartByWidget(widgetId, widget?.title, 'svg');
        break;

      case 'focus':
        handleFocusWidget(widgetId);
        break;

      case 'explain':
        setExplainWidgetId(widgetId);
        break;

      case 'delete':
        Modal.confirm({
          title: td('delete_widget_confirm_title') || 'Delete widget?',
          content: td('delete_widget_confirm_body') || 'This action cannot be undone.',
          okText: td('delete_widget') || 'Delete',
          okButtonProps: { danger: true },
          onOk: () => removeWidget(widgetId),
        });
        break;

      case 'configure':
        setPropertiesCollapsed(false);
        break;

      case 'lock':
        onUpdateWidget?.(widgetId, { isLocked: !widget.isLocked });
        break;

      default:
        if (key.startsWith('move-to-page-')) {
          const targetPageId = key.replace('move-to-page-', '');
          void onMoveWidgetToPage?.(widgetId, targetPageId);
          break;
        }
        if (key.startsWith('copy-to-')) {
          const targetDashboardId = key.replace('copy-to-', '');
          handleCopyToDashboard(targetDashboardId, widget);
        }
        break;
    }
  };

  const getMenuItems = (widgetId?: string) => {
    const w = widgetId ? widgets.find((x) => x.id === widgetId) : null;
    const isNonChart = w && (w.chartType === 'text' || w.chartType === 'slicer' || w.chartType === 'filter' || w.chartType === 'divider' || w.chartType === 'image');
    const items: any[] = [
    {
      key: 'configure',
      label: td('widget_settings'),
      icon: <SettingOutlined />,
    },
    {
      key: 'focus',
      label: td('focus_widget') || 'Expand / Focus',
      icon: <FullscreenOutlined />,
    },
    {
      key: 'duplicate',
      label: td('duplicate_widget'),
      icon: <CopyOutlined />,
    },
    ];

    if (pages.length > 1 && onMoveWidgetToPage) {
      items.push({
        key: 'move-to-page',
        label: td('move_to_page'),
        children: pages.map((p) => ({
          key: `move-to-page-${p.id}`,
          label: p.name,
        })),
      });
    }

    if (!isNonChart) {
      items.push({
        key: 'explain',
        label: 'Explain with AI',
        icon: <RobotOutlined />,
      });
    }

    items.push(
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
    ...(!isNonChart ? [
      {
        key: 'export-data',
        label: 'Export Data',
        icon: <FileExcelOutlined />,
        children: [
          { key: 'export-csv', label: 'Export CSV', icon: <FileTextOutlined /> },
          { key: 'export-excel', label: 'Export Excel (.xlsx)', icon: <FileExcelOutlined /> },
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
    ] : []),
    { type: 'divider' as const },
    {
      key: 'lock',
      label: w?.isLocked ? 'Unlock widget' : 'Lock widget (prevent move/resize)',
      icon: w?.isLocked ? <UnlockOutlined /> : <LockOutlined />,
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      label: td('delete_widget'),
      icon: <DeleteOutlined />,
      danger: true,
    },
    );

    return items;
  };

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

  const zoomStyle: React.CSSProperties = canvasZoom !== 100
    ? { zoom: `${canvasZoom}%` }
    : {};

  return (
    <div
      className={`dashboard-container ${isDragOver && isEditing ? 'drag-over' : ''} ${readOnly ? 'read-only is-viewing' : 'is-editing'}`}
      style={zoomStyle}
      onClick={(e) => {
        if (!isDesigner && !readOnly) {
          setSelectedWidgetId(null);
          if (!(e.target as HTMLElement).closest('.widget-card')) {
            clearMultiSelection();
          }
        }
      }}
      onDragOver={(e) => {
        if (!isEditing) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (!isEditing) return;
        setIsDragOver(false);
        try {
          const data = e.dataTransfer.getData('application/json');
          if (data) onDropWidget?.(JSON.parse(data));
        } catch (err) {
          console.error(err);
        }
      }}
      onMouseMove={(e) => {
        if (!onCollabCursorMove || readOnly) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        const widgetEl = (e.target as HTMLElement).closest('[data-widget-id]');
        const widgetId = widgetEl?.getAttribute('data-widget-id');
        onCollabCursorMove(x, y, widgetId);
      }}
    >
      {/* Multi-select floating toolbar */}
      {selectedWidgetIds.size > 0 && isEditing && (
        <div
          style={{
            position: 'fixed',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'var(--ant-color-bg-container, #fff)',
            border: '1px solid var(--ant-color-border, #d9d9d9)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Typography.Text style={{ fontSize: 13, fontWeight: 600 }}>
            {selectedWidgetIds.size} widget{selectedWidgetIds.size !== 1 ? 's' : ''} selected
          </Typography.Text>
          <Button
            size="small"
            onClick={clearMultiSelection}
          >
            Clear
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: `Delete ${selectedWidgetIds.size} widget${selectedWidgetIds.size !== 1 ? 's' : ''}?`,
                content: 'This cannot be undone.',
                okText: 'Delete all',
                okButtonProps: { danger: true },
                onOk: () => bulkDeleteWidgets(),
              });
            }}
          >
            Delete selected
          </Button>
        </div>
      )}

      <ResponsiveGridLayout
        className="layout"
        layouts={{
          lg: layout.map((item) => ({ ...item, static: !isEditing || !!widgetById.get(item.i)?.isLocked })),
          md: layout.map((item) => ({ ...item, static: !isEditing || !!widgetById.get(item.i)?.isLocked })),
          sm: layout.map((item) => ({ ...item, static: !isEditing || !!widgetById.get(item.i)?.isLocked })),
          xs: layout.map((item) => ({ ...item, static: !isEditing || !!widgetById.get(item.i)?.isLocked })),
          xxs: layout.map((item) => ({ ...item, static: !isEditing || !!widgetById.get(item.i)?.isLocked })),
        }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
        rowHeight={isDesigner ? designerRowHeight : 42}
        margin={isDesigner ? [0, 0] : [8, 8]}
        containerPadding={[0, 0]}
        compactType={null}
        preventCollision
        isDraggable={isEditing}
        isResizable={isEditing}
        /* Do not persist from onLayoutChange. React Grid Layout also fires it on
           mount/page restore/breakpoint recalculation, which can overwrite saved
           page layout with generated default positions. Persist only final user actions. */
        onDragStop={(nextLayout) => {
          commitLayout(nextLayout, { sync: true });
        }}
        onResizeStop={(nextLayout) => {
          commitLayout(nextLayout, { sync: true });
        }}
        draggableHandle=".widget-card-header, .drag-handle"
        draggableCancel=".no-drag"
      >
        {widgets.map((w) => {
          const isText = w.chartType === 'text';
          const isSelected = selectedWidgetId === w.id;
          const isMultiSelected = selectedWidgetIds.has(w.id);
          const showHeader = shouldShowWidgetHeader(w, { isSelected });
          const crossFilterField = w.chartQuery?.x as string | undefined;
          const isCrossFilterSource =
            !!crossFilterField && getCrossFilterValues(runtimeFilters, crossFilterField).length > 0;

          const isLayoutSlot = isLayoutSlotWidget(w);

          return (
            <div key={w.id} data-widget-id={w.id} className={isLayoutSlot ? 'dashboard-canvas-slot-placeholder' : undefined}>
              <div
                className={`widget-card ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${isCrossFilterSource ? 'is-cross-filter-source' : ''} ${peerEditingWidgetId === w.id ? 'is-peer-editing' : ''} widget-type-${w.chartType} ${!showHeader ? 'header-hidden' : ''} ${w.chartOptions?.backgroundColor === 'transparent' ? 'is-transparent' : ''} ${isLayoutSlot ? 'is-layout-slot' : ''}`}
                data-widget-id={w.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readOnly) return;
                  if (e.shiftKey && isEditing) {
                    // Shift+click: add/remove from multi-selection
                    toggleWidgetInSelection(w.id);
                    return;
                  }
                  // Normal click: clear multi-selection, select single widget
                  clearMultiSelection();
                  setSelectedWidgetId(w.id);
                  setPropertiesCollapsed(false);
                }}
                style={{
                  backgroundColor: w.chartOptions?.backgroundColor || undefined,
                  ...(w.chartOptions?.borderWidth && Number(w.chartOptions.borderWidth) > 0 ? {
                    border: `${w.chartOptions.borderWidth}px solid ${w.chartOptions.borderColor || '#d9d9d9'}`,
                  } : {}),
                  ...(w.chartOptions?.boxShadow && w.chartOptions.boxShadow !== 'none' ? {
                    boxShadow: ({
                      sm: '0 1px 4px rgba(0,0,0,0.10)',
                      md: '0 4px 12px rgba(0,0,0,0.15)',
                      lg: '0 8px 24px rgba(0,0,0,0.22)',
                    } as Record<string, string>)[w.chartOptions.boxShadow as string],
                  } : {}),
                }}
              >
                <div
                  className={`widget-card-header${typeof w.chartOptions?.subtitle === 'string' && w.chartOptions.subtitle.trim() ? ' widget-card-header-stack' : ''}`}
                  style={{ display: showHeader ? 'flex' : 'none' }}
                >
                  <div className="widget-card-header-titles">
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
                        if (!isEditing) return;
                        e.preventDefault();
                        e.stopPropagation();
                        startEditing(w);
                      }}
                      title={isEditing ? 'Double click to edit title' : undefined}
                      style={{
                        cursor: isEditing ? 'pointer' : 'default',
                        userSelect: 'none',
                        fontWeight: w.chartOptions?.titleFontWeight || '700',
                        color: w.chartOptions?.titleColor || undefined,
                      }}
                    >
                      {w.title}
                    </Text>
                  )}
                  {typeof w.chartOptions?.subtitle === 'string' && w.chartOptions.subtitle.trim() ? (
                    <span className="widget-card-subtitle">{w.chartOptions.subtitle}</span>
                  ) : null}
                  </div>

                  {isCrossFilterSource && (
                    <Tooltip title={td('cross_filter_source_tooltip')}>
                      <span className="widget-cross-filter-badge">
                        <FilterOutlined />
                        {td('cross_filter_source')}
                      </span>
                    </Tooltip>
                  )}

                  {w.isLocked && isEditing && (
                    <Tooltip title="Widget is locked — right-click to unlock">
                      <LockOutlined style={{ fontSize: 11, color: 'var(--ant-color-text-quaternary)', marginRight: 4 }} />
                    </Tooltip>
                  )}

                  {selectedWidgetId === w.id && !editingWidgetId && isEditing && (
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      menu={{
                        items: getMenuItems(w.id),
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

                {isEditing && (
                <div className="drag-handle-icon drag-handle middle-top">
                  <HolderOutlined rotate={90} />
                </div>
                )}

              <div className={`widget-card-body ${isText && !showHeader && isEditing ? 'drag-handle' : 'no-drag'}`}>
                <DashboardWidgetCell
                  widget={w}
                  dashboardId={dashboardId}
                  runtimeFilters={runtimeFilters}
                  readOnly={readOnly}
                  onCrossFilter={onCrossFilter}
                  onWidgetChartClick={onWidgetChartClick}
                  onUpdateConfig={
                    readOnly
                      ? undefined
                      : (updates) =>
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

      {widgets.length === 0 && isEditing && (
        <div className="canvas-empty">
          <div className="canvas-empty-content">
            <WidgetBlockPicker variant="canvas" onSelect={(template) => onAddWidget(template)} />
          </div>
        </div>
      )}

      {/* Explain with AI Drawer */}
      {isEnterpriseEdition() && (
      <ExplainChartDrawer
        open={!!explainWidgetId}
        onClose={() => setExplainWidgetId(null)}
        widget={explainWidgetId ? (widgets.find((w) => w.id === explainWidgetId) ?? null) : null}
      />
      )}

      {/* Widget Focus / Expand Modal */}
      {focusedWidgetId && (() => {
        const fw = widgets.find((w) => w.id === focusedWidgetId);
        if (!fw) return null;
        return (
          <Modal
            open
            onCancel={handleExitFocus}
            footer={null}
            width="90vw"
            style={{ top: 24 }}
            styles={{ body: { padding: 0, height: 'calc(90vh - 80px)', display: 'flex', flexDirection: 'column' } }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FullscreenExitOutlined />
                <span>{fw.title || 'Widget Preview'}</span>
              </div>
            }
          >
            <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: 16 }}>
              <DashboardWidgetCell
                widget={fw}
                dashboardId={dashboardId}
                runtimeFilters={runtimeFilters}
                readOnly={readOnly}
                onCrossFilter={onCrossFilter}
                onWidgetChartClick={onWidgetChartClick}
                isDesigner={isDesigner}
                isSelected
              />
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}