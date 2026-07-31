'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Typography, Dropdown, message, Input, Tooltip, Modal, Table } from 'antd';
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
  TableOutlined,
} from '@ant-design/icons';
import { ExplainChartDrawer } from '../components/ExplainChartDrawer';
import { DashboardWidgetCell } from '../components/DashboardWidgetCell';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { getCrossFilterValues } from '../utils/filterOperators';
import { shouldShowWidgetHeader } from '../utils/widgetCardHelpers';
import { DashboardIcon } from '../icons';
import '../icons/IconPicker.css';
import { isLayoutSlotWidget } from '../utils/layoutScaffolds';
import '../components/AddDashboardDrawer.css';
import { WidgetBlockPicker } from '../components/WidgetBlockPicker';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { exportChartByWidget } from '../services/exportChartImageService';
import { exportCSV, exportExcel, normalizeToRows } from '../services/exportChartDataService';
import { useDashboardStore, useUndo, useRedo } from '../stores/useDashboardStore';
import { useTranslations } from 'next-intl';
import { columnHeaderFromKey } from '@/utils/columnLabels';
import { formatNumber } from '../utils/numberFormatter';
import { resolveLayoutCollisions, hasLayoutOverlaps } from '../utils/layoutSanitize';

const { Text } = Typography;
const ResponsiveGridLayout = WidthProvider(Responsive);

// Layout x/y/w/h values are authored against the base (lg, 12-column) grid — the
// `cols` prop below only changes how that same grid renders at narrower breakpoints —
// so keyboard nudge/resize bounds are checked against this fixed reference, and widget
// templates don't define per-type minimums (see widgetTemplates.tsx), hence a shared floor.
const GRID_COLS = 12;
const GRID_MIN_W = 2;
const GRID_MIN_H = 2;

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
  onDropWidget?: (template: any, position?: { x: number; y: number }) => void;
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

  /** Only mirror RGL into React state while the user is actively dragging/resizing.
   *  Mount/breakpoint/WidthProvider noise must not rewrite saved layout. */
  const layoutGestureRef = React.useRef(false);
  /** Snapshot so Escape / cancelled gestures restore neighbors untouched. */
  const layoutBeforeGestureRef = React.useRef<any[] | null>(null);
  const gestureCancelledRef = React.useRef(false);

  const commitLayout = useCallback(
    (
      nextLayout: any[],
      options?: {
        sync?: boolean;
        movedId?: string | null;
        before?: { x: number; y: number; w: number; h: number } | null;
        /** Skip collision resolve (Escape restore of a known-clean snapshot). */
        skipResolve?: boolean;
      },
    ) => {
      const cleanedLayout = cleanLayout(nextLayout);
      const resolvedLayout = options?.skipResolve
        ? cleanedLayout
        : resolveLayoutCollisions(cleanedLayout, {
            movedId: options?.movedId ?? null,
            cols: GRID_COLS,
            before: options?.before ?? null,
          });

      if (onPageLayoutChange) {
        onPageLayoutChange(resolvedLayout);
      } else {
        setLayout(resolvedLayout);
      }

      if (options?.sync) {
        onLayoutSync?.(resolvedLayout);
      }

      return resolvedLayout;
    },
    [cleanLayout, onLayoutSync, onPageLayoutChange, setLayout]
  );

  /** Stable RGL layouts map — always 12 cols so properties overlay never changes grid units. */
  const rglLayouts = useMemo(() => {
    const withStatic = layout.map((item) => ({
      ...item,
      static: !isEditing || !!widgetById.get(item.i)?.isLocked,
      minW: Math.max(GRID_MIN_W, Number(item.minW) || GRID_MIN_W),
      minH: Math.max(GRID_MIN_H, Number(item.minH) || GRID_MIN_H),
    }));
    return {
      lg: withStatic,
      md: withStatic,
      sm: withStatic,
      xs: withStatic,
      xxs: withStatic,
    };
  }, [layout, isEditing, widgetById]);

  /** One-shot heal for layouts saved while allowOverlap left stacked widgets. */
  useEffect(() => {
    if (!isEditing || layoutGestureRef.current) return;
    if (!layout.length || !hasLayoutOverlaps(layout)) return;
    commitLayout(layout, { sync: true });
  }, [isEditing, layout, commitLayout]);

  const handleLayoutChange = useCallback(
    (current: any[]) => {
      if (!isEditing || !layoutGestureRef.current || gestureCancelledRef.current) return;
      // During drag/resize keep neighbors put (allowOverlap). Resolve once on stop.
      commitLayout(current, { sync: false, skipResolve: true });
    },
    [commitLayout, isEditing]
  );

  const beginLayoutGesture = useCallback(() => {
    layoutGestureRef.current = true;
    gestureCancelledRef.current = false;
    layoutBeforeGestureRef.current = layout.map((item) => ({ ...item }));
  }, [layout]);

  /** Suppress the synthetic click that browsers fire after HTML5 drop / RGL drag,
   *  so the properties panel opens only on intentional click/select. */
  const suppressPropertiesOpenUntilRef = React.useRef(0);

  const suppressPropertiesOpenBriefly = useCallback(() => {
    suppressPropertiesOpenUntilRef.current = Date.now() + 450;
  }, []);

  const openPropertiesIfAllowed = useCallback(() => {
    if (Date.now() < suppressPropertiesOpenUntilRef.current) return;
    setPropertiesCollapsed(false);
  }, [setPropertiesCollapsed]);

  const cancelLayoutGesture = useCallback(() => {
    if (!layoutBeforeGestureRef.current) return;
    gestureCancelledRef.current = true;
    layoutGestureRef.current = false;
    suppressPropertiesOpenBriefly();
    commitLayout(layoutBeforeGestureRef.current.map((item) => ({ ...item })), {
      sync: false,
      skipResolve: true,
    });
  }, [commitLayout, suppressPropertiesOpenBriefly]);

  const endLayoutGesture = useCallback(
    (nextLayout: any[], movedId?: string | null, beforeItem?: { x: number; y: number; w: number; h: number } | null) => {
      layoutGestureRef.current = false;
      suppressPropertiesOpenBriefly();

      // Escape (or other cancel) already restored the snapshot — ignore the stop event.
      if (gestureCancelledRef.current) {
        gestureCancelledRef.current = false;
        const snapshot = layoutBeforeGestureRef.current;
        layoutBeforeGestureRef.current = null;
        if (snapshot) {
          commitLayout(snapshot.map((item) => ({ ...item })), {
            sync: false,
            skipResolve: true,
          });
        }
        return;
      }

      const beforeFromSnapshot =
        beforeItem ||
        (movedId && layoutBeforeGestureRef.current
          ? layoutBeforeGestureRef.current.find((item) => String(item.i) === String(movedId))
          : null);

      layoutBeforeGestureRef.current = null;
      commitLayout(nextLayout, {
        sync: true,
        movedId: movedId ?? null,
        before: beforeFromSnapshot
          ? {
              x: Number(beforeFromSnapshot.x),
              y: Number(beforeFromSnapshot.y),
              w: Number(beforeFromSnapshot.w),
              h: Number(beforeFromSnapshot.h),
            }
          : null,
      });
    },
    [commitLayout, suppressPropertiesOpenBriefly]
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
  const [tableWidgetId, setTableWidgetId] = useState<string | null>(null);
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

      // Escape during drag/resize — cancel and restore pre-gesture layout
      if (e.key === 'Escape' && layoutGestureRef.current) {
        e.preventDefault();
        cancelLayoutGesture();
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

      // Arrow keys — nudge selected widget by one grid unit; Shift+Arrow — resize
      // it by one grid unit (grow/shrink w/h depending on direction). Mirrors what
      // a mouse drag/resize does by going through the same commitLayout path react-grid-layout's
      // onDragStop/onResizeStop use, so persistence/sync behaves identically.
      if (selectedWidgetId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const widget = widgetById.get(selectedWidgetId);
        if (widget?.isLocked) return; // mouse drag/resize is disabled for locked widgets too
        e.preventDefault();
        const itemIdx = layout.findIndex((l) => l.i === selectedWidgetId);
        if (itemIdx < 0) return;
        const item = layout[itemIdx];
        if (!item) return;
        let { x, y, w, h } = item;

        if (e.shiftKey) {
          // Resize
          const before = { x, y, w, h };
          if (e.key === 'ArrowLeft') w = Math.max(GRID_MIN_W, w - 1);
          if (e.key === 'ArrowRight') w = Math.min(GRID_COLS - x, w + 1);
          if (e.key === 'ArrowUp') h = Math.max(GRID_MIN_H, h - 1);
          if (e.key === 'ArrowDown') h = h + 1;
          const next = [...layout];
          next[itemIdx] = { ...item, x, y, w, h };
          commitLayout(next, {
            sync: true,
            movedId: selectedWidgetId,
            before,
          });
        } else {
          // Move
          if (e.key === 'ArrowLeft') x = Math.max(0, x - 1);
          if (e.key === 'ArrowRight') x = Math.min(GRID_COLS - w, x + 1);
          if (e.key === 'ArrowUp') y = Math.max(0, y - 1);
          if (e.key === 'ArrowDown') y = y + 1;
          const next = [...layout];
          next[itemIdx] = { ...item, x, y, w, h };
          commitLayout(next, {
            sync: true,
            movedId: selectedWidgetId,
          });
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, selectedWidgetId, focusedWidgetId, widgets, widgetById, removeWidget, duplicateWidget, setSelectedWidgetId, td, undo, redo, canvasZoom, setCanvasZoom, layout, commitLayout, cancelLayoutGesture]);

  const dashboards = useDashboardStore((s) => s.dashboards);
  const isLoadingDashboards = useDashboardStore((s) => s.isLoadingDashboards);
  const hasLoadedDashboards = useDashboardStore((s) => s.hasLoadedDashboards);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const linkWidgetToDashboard = useDashboardStore((s) => s.linkWidgetToDashboard);

  useEffect(() => {
    if (!hasLoadedDashboards && !isLoadingDashboards) {
      void fetchDashboards();
    }
  }, [fetchDashboards, hasLoadedDashboards, isLoadingDashboards]);

  const handleCopyToDashboard = async (targetDashboardId: string, widget: any) => {
    try {
      const layoutItem = layout.find((l) => l.i === widget.id);
      // Prefer link (shared library definition) when the widget already has a chartId.
      // Fall back to copy for unsaved / ephemeral widgets.
      if (widget?.chartId) {
        await linkWidgetToDashboard(widget, layoutItem, targetDashboardId, 'link');
        message.success('Widget linked to dashboard');
      } else {
        await useDashboardStore.getState().copyWidgetToDashboard(widget, layoutItem, targetDashboardId);
        message.success('Widget copied to dashboard successfully');
      }

      if (isDesigner) {
        router.push(`/dashboards?id=${targetDashboardId}&mode=edit`);
      }
    } catch (error) {
      console.error('Failed to pin widget:', error);
      message.error('Failed to add widget to dashboard');
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

      case 'view-table': {
        const rows = normalizeToRows(widget.chartData, widget);
        if (!rows.length) {
          message.info(td('view_table_empty'));
          break;
        }
        setTableWidgetId(widgetId);
        break;
      }

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
      label: td('focus_widget'),
      icon: <FullscreenOutlined />,
    },
    ...(!isNonChart
      ? [
          {
            key: 'view-table',
            label: td('view_table'),
            icon: <TableOutlined />,
          },
        ]
      : []),
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
        e.preventDefault();
        setIsDragOver(false);
        // Drop synthesizes a click on whatever lands under the cursor — ignore it.
        suppressPropertiesOpenBriefly();
        try {
          const data = e.dataTransfer.getData('application/json');
          if (!data) return;
          const template = JSON.parse(data);
          const rect = e.currentTarget.getBoundingClientRect();
          const marginX = isDesigner ? 0 : 8;
          const marginY = isDesigner ? 0 : 8;
          const rowHeight = isDesigner ? designerRowHeight : 42;
          const width = Math.max(1, rect.width);
          const colWidth = (width - marginX * (GRID_COLS - 1)) / GRID_COLS;
          const relX = e.clientX - rect.left;
          const relY = e.clientY - rect.top;
          const gridX = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(relX / (colWidth + marginX))));
          const gridY = Math.max(0, Math.floor(relY / (rowHeight + marginY)));
          onDropWidget?.(template, { x: gridX, y: gridY });
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

      {/* Free placement. Overlap allowed while gesturing so RGL does not cascade
          neighbors downward; on stop we swap or nudge just enough. Escape restores. */}
      <ResponsiveGridLayout
        className="layout"
        layouts={rglLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
        rowHeight={isDesigner ? designerRowHeight : 42}
        margin={isDesigner ? [0, 0] : [8, 8]}
        containerPadding={[0, 0]}
        compactType={null}
        preventCollision={false}
        allowOverlap={true}
        isBounded={isEditing}
        isDraggable={isEditing}
        isResizable={isEditing}
        resizeHandles={['se', 'nw']}
        onLayoutChange={handleLayoutChange}
        onDragStart={beginLayoutGesture}
        onResizeStart={beginLayoutGesture}
        onDragStop={(nextLayout, oldItem, newItem) => {
          endLayoutGesture(nextLayout, newItem?.i, oldItem);
        }}
        onResizeStop={(nextLayout, oldItem, newItem) => {
          endLayoutGesture(nextLayout, newItem?.i, oldItem);
        }}
        draggableHandle=".widget-card-header, .drag-handle"
        draggableCancel=".no-drag"
      >
        {widgets.map((w) => {
          const isText = w.chartType === 'text';
          const isSelected = selectedWidgetId === w.id;
          const isMultiSelected = selectedWidgetIds.has(w.id);
          const showHeader = shouldShowWidgetHeader(w, { isSelected, isDesigner });
          const crossFilterField = w.chartQuery?.x as string | undefined;
          const isCrossFilterSource =
            !!crossFilterField && getCrossFilterValues(runtimeFilters, crossFilterField).length > 0;

          const isLayoutSlot = isLayoutSlotWidget(w);
          const layoutItem = layout.find((l) => l.i === w.id);
          const canKeyboardMove = isEditing && !w.isLocked && !isLayoutSlot;
          const widgetAriaLabel = layoutItem
            ? `${w.title || w.chartType || 'Widget'}. Column ${layoutItem.x + 1} of ${GRID_COLS}, row ${layoutItem.y + 1}, size ${layoutItem.w} by ${layoutItem.h} grid units.${canKeyboardMove ? ' Use arrow keys to move, Shift plus arrow keys to resize.' : ''}`
            : w.title || w.chartType || 'Widget';

          return (
            <div key={w.id} data-widget-id={w.id} className={isLayoutSlot ? 'dashboard-canvas-slot-placeholder' : undefined}>
              <div
                className={`widget-card ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${isCrossFilterSource ? 'is-cross-filter-source' : ''} ${peerEditingWidgetId === w.id ? 'is-peer-editing' : ''} widget-type-${w.chartType} ${!showHeader ? 'header-hidden' : ''} ${w.chartOptions?.backgroundColor === 'transparent' ? 'is-transparent' : ''} ${isLayoutSlot ? 'is-layout-slot' : ''}`}
                data-widget-id={w.id}
                role="group"
                aria-label={widgetAriaLabel}
                tabIndex={canKeyboardMove ? 0 : undefined}
                onFocus={canKeyboardMove ? () => setSelectedWidgetId(w.id) : undefined}
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
                  openPropertiesIfAllowed();
                }}
                style={{
                  backgroundColor: w.chartOptions?.backgroundColor || undefined,
                  ...(w.chartType === 'text'
                    ? { border: 'none', boxShadow: 'none' }
                    : w.chartOptions?.borderWidth && Number(w.chartOptions.borderWidth) > 0
                      ? {
                          border: `${w.chartOptions.borderWidth}px solid ${w.chartOptions.borderColor || '#d9d9d9'}`,
                        }
                      : {}),
                  ...(w.chartType !== 'text' &&
                  w.chartOptions?.boxShadow &&
                  w.chartOptions.boxShadow !== 'none'
                    ? {
                        boxShadow: ({
                          sm: '0 1px 4px rgba(0,0,0,0.10)',
                          md: '0 4px 12px rgba(0,0,0,0.15)',
                          lg: '0 8px 24px rgba(0,0,0,0.22)',
                        } as Record<string, string>)[w.chartOptions.boxShadow as string],
                      }
                    : {}),
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
                      title={
                        isEditing
                          ? `${w.title || ''} — Double click to edit`
                          : w.title || undefined
                      }
                      style={{
                        cursor: isEditing ? 'pointer' : 'default',
                        userSelect: 'none',
                        fontWeight: w.chartOptions?.titleFontWeight || '700',
                        color: w.chartOptions?.titleColor || undefined,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0,
                      }}
                    >
                      {w.chartOptions?.headerIcon ? (
                        <span
                          className="widget-header-icon"
                          style={{ color: (w.chartOptions.headerIcon as { color?: string })?.color || w.chartOptions?.titleColor || undefined }}
                        >
                          <DashboardIcon icon={w.chartOptions.headerIcon} size={14} />
                        </span>
                      ) : null}
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

                  {(selectedWidgetId === w.id && !editingWidgetId) && (
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      overlayClassName="widget-overflow-dropdown"
                      getPopupContainer={() => document.body}
                      menu={{
                        items: isEditing
                          ? getMenuItems(w.id)
                          : getMenuItems(w.id).filter((item: any) => {
                              if (!item || item.type === 'divider') return false;
                              return ['focus', 'view-table', 'explain', 'export-data', 'export-image'].includes(
                                item.key,
                              );
                            }),
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

                {/* Text: title lives inside TextWidget; keep ⋯ menu when selected */}
                {isText && isSelected && (
                  <div className="widget-text-floating-actions no-drag">
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      overlayClassName="widget-overflow-dropdown"
                      getPopupContainer={() => document.body}
                      menu={{
                        items: isEditing
                          ? getMenuItems(w.id)
                          : getMenuItems(w.id).filter((item: any) => {
                              if (!item || item.type === 'divider') return false;
                              return ['focus', 'view-table', 'explain', 'export-data', 'export-image'].includes(
                                item.key,
                              );
                            }),
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
                  </div>
                )}

              <div className="widget-card-body no-drag">
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
                      : (updates) => {
                          if (updates && typeof updates === 'object' && '__widgetTitle' in updates) {
                            onUpdateWidget?.(w.id, {
                              title: String((updates as { __widgetTitle?: unknown }).__widgetTitle ?? ''),
                            });
                            return;
                          }
                          onUpdateWidget?.(w.id, {
                            chartOptions: { ...(w.chartOptions || {}), ...updates },
                          });
                        }
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

      {/* Widget Focus / View Full Modal — size by widget type; stay above studio chrome */}
      {focusedWidgetId && (() => {
        const fw = widgets.find((w) => w.id === focusedWidgetId);
        if (!fw) return null;
        const chartType = String(fw.chartType || '').toLowerCase();
        const isKpi = chartType === 'stat' || chartType === 'gauge' || chartType === 'kpi';
        const isPie = chartType === 'pie' || chartType === 'donut';
        const isTableish = chartType === 'table' || chartType === 'pivot' || chartType === 'heatmap';
        const isChrome =
          chartType === 'text' ||
          chartType === 'image' ||
          chartType === 'divider' ||
          chartType === 'filter' ||
          chartType === 'slicer';

        let modalWidth: number | string = 880;
        let bodyMinHeight = 420;
        let bodyMaxHeight = 'min(72vh, 560px)';
        if (isKpi) {
          modalWidth = 480;
          bodyMinHeight = 240;
          bodyMaxHeight = 'min(50vh, 320px)';
        } else if (isPie) {
          modalWidth = 640;
          bodyMinHeight = 360;
          bodyMaxHeight = 'min(65vh, 480px)';
        } else if (isTableish) {
          modalWidth = 'min(960px, 92vw)';
          bodyMinHeight = 360;
          bodyMaxHeight = 'min(75vh, 640px)';
        } else if (isChrome) {
          modalWidth = 640;
          bodyMinHeight = 200;
          bodyMaxHeight = 'min(55vh, 400px)';
        }

        return (
          <Modal
            open
            centered
            destroyOnHidden
            onCancel={handleExitFocus}
            footer={null}
            width={modalWidth}
            zIndex={1200}
            className={`studio-widget-inspect-modal${isKpi ? ' studio-widget-inspect-modal--kpi' : ''}`}
            afterOpenChange={(open) => {
              if (open) {
                // Let ECharts ResizeObserver/layout settle after modal size is known
                requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
              }
            }}
            styles={{
              body: {
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: bodyMinHeight,
                height: typeof bodyMaxHeight === 'string' ? bodyMinHeight : bodyMinHeight,
                maxHeight: bodyMaxHeight,
              },
            }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FullscreenExitOutlined />
                <span>{fw.title || td('focus_widget')}</span>
              </div>
            }
          >
            <div className="studio-widget-inspect-host">
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

      {/* View Table Modal — width scales with columns; scroll inside, not the whole app chrome */}
      {tableWidgetId && (() => {
        const tw = widgets.find((w) => w.id === tableWidgetId);
        if (!tw) return null;
        const rows = normalizeToRows(tw.chartData, tw);
        const keys = rows.length ? Object.keys(rows[0]) : [];
        const columns = keys.map((key) => ({
          title: columnHeaderFromKey(key),
          dataIndex: key,
          key,
          ellipsis: true,
          render: (val: unknown) => {
            if (val === null || val === undefined) return '—';
            if (typeof val === 'object') return JSON.stringify(val);
            if (typeof val === 'number' && Number.isFinite(val)) {
              return formatNumber(val, { decimals: 2, compact: false });
            }
            if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
              const n = Number(val);
              if (Number.isFinite(n)) return formatNumber(n, { decimals: 2, compact: false });
            }
            return String(val);
          },
        }));
        const modalWidth = Math.min(960, Math.max(520, 160 + keys.length * 120));
        const scrollY = Math.min(520, Math.max(200, Math.min(rows.length, 14) * 38 + 8));
        return (
          <Modal
            open
            centered
            destroyOnHidden
            onCancel={() => setTableWidgetId(null)}
            footer={null}
            width={modalWidth}
            zIndex={1200}
            className="studio-widget-inspect-modal studio-widget-inspect-modal--table"
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  {td('view_table')}
                  <span style={{ marginLeft: 8, opacity: 0.65, fontWeight: 400, fontSize: 13 }}>
                    {tw.title || 'Widget'} · {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                  </span>
                </span>
              </div>
            }
          >
            <Table
              size="small"
              bordered
              className="query-results-table"
              dataSource={rows.map((r, i) => ({ ...r, key: i }))}
              columns={columns}
              scroll={{ x: 'max-content', y: scrollY }}
              pagination={{
                pageSize: 25,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50', '100'],
                size: 'small',
                showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}
