'use client';

import React, { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { DashboardWidgetCell } from '../DashboardWidgetCell';
import { shouldShowWidgetHeader } from '../../utils/widgetCardHelpers';
import type { LayoutItem, RuntimeFilter, WidgetInstance } from '../../stores/useDashboardStore';

const ResponsiveGridLayout = WidthProvider(Responsive);

type Props = {
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  dashboardId: string;
  runtimeFilters: RuntimeFilter[];
  onCrossFilter: (field: string, value: unknown) => void;
  onWidgetChartClick?: (widget: WidgetInstance, field: string, value: unknown, shiftKey: boolean) => void;
  onRetryWidget?: (widgetId: string) => void;
  refreshing?: boolean;
  canvasMinHeight?: string;
  layoutMode?: 'preserve' | 'preview';
};

function getPreviewWidgetHeight(widget: WidgetInstance, sourceLayout?: LayoutItem): number {
  if (widget.chartType === 'divider') return 2;
  if (widget.chartType === 'stat') return 4;
  if (widget.chartType === 'text' || widget.chartType === 'image') return 5;
  return Math.min(8, Math.max(6, sourceLayout?.h || 7));
}

function buildPreviewLayout(
  widgets: WidgetInstance[],
  sourceLayout: LayoutItem[],
  columns: number,
  columnCount: number
): LayoutItem[] {
  const sourceById = new Map(sourceLayout.map((item) => [item.i, item]));
  const orderedWidgets = [...widgets].sort((left, right) => {
    const leftPosition = sourceById.get(left.id);
    const rightPosition = sourceById.get(right.id);

    if (!leftPosition && !rightPosition) return 0;
    if (!leftPosition) return 1;
    if (!rightPosition) return -1;

    return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x;
  });
  const itemWidth = Math.floor(columns / columnCount);
  const result: LayoutItem[] = [];
  let rowY = 0;

  for (let index = 0; index < orderedWidgets.length; index += columnCount) {
    const rowWidgets = orderedWidgets.slice(index, index + columnCount);
    const rowHeight = Math.max(
      ...rowWidgets.map((widget) => getPreviewWidgetHeight(widget, sourceById.get(widget.id)))
    );

    rowWidgets.forEach((widget, columnIndex) => {
      result.push({
        i: widget.id,
        x: columnIndex * itemWidth,
        y: rowY,
        w: itemWidth,
        h: rowHeight,
      });
    });
    rowY += rowHeight;
  }

  return result;
}

export function DashboardViewerGrid({
  widgets,
  layout,
  dashboardId,
  runtimeFilters,
  onCrossFilter,
  onWidgetChartClick,
  onRetryWidget,
  refreshing = false,
  canvasMinHeight = 'calc(100vh - 180px)',
  layoutMode = 'preserve',
}: Props) {
  const responsiveLayouts = useMemo(() => {
    if (layoutMode === 'preserve') {
      return {
        lg: layout,
        md: layout,
        sm: layout,
        xs: layout,
        xxs: layout,
      };
    }

    return {
      lg: buildPreviewLayout(widgets, layout, 12, 2),
      md: buildPreviewLayout(widgets, layout, 10, 2),
      sm: buildPreviewLayout(widgets, layout, 6, 1),
      xs: buildPreviewLayout(widgets, layout, 4, 1),
      xxs: buildPreviewLayout(widgets, layout, 2, 1),
    };
  }, [layout, layoutMode, widgets]);

  return (
    <div className="dashboard-canvas-wrapper dashboard-viewer-canvas" style={{ minHeight: canvasMinHeight }}>
      <ResponsiveGridLayout
        className="layout"
        style={{ opacity: refreshing ? 0.72 : 1, transition: 'opacity 0.2s ease' }}
        layouts={{
          lg: responsiveLayouts.lg.map((item) => ({ ...item, static: true })),
          md: responsiveLayouts.md.map((item) => ({ ...item, static: true })),
          sm: responsiveLayouts.sm.map((item) => ({ ...item, static: true })),
          xs: responsiveLayouts.xs.map((item) => ({ ...item, static: true })),
          xxs: responsiveLayouts.xxs.map((item) => ({ ...item, static: true })),
        }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={
          layoutMode === 'preserve'
            // 'preserve' reuses the Studio canvas's saved x/y/w/h verbatim (see
            // DashboardCanvas.tsx), which are authored against a constant 12-column
            // grid at every breakpoint. Keeping cols at 12 here too — instead of
            // narrowing to 10/6/4/2 — is what lets WidthProvider shrink column
            // *width* on smaller screens without invalidating those positions
            // (item.x + item.w must stay <= cols, or items collide/overlap and
            // widgets appear to vanish).
            ? { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }
            : { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
        }
        rowHeight={42}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        isDraggable={false}
        isResizable={false}
        useCSSTransforms
      >
        {widgets.map((widget) => {
          const showHeader = shouldShowWidgetHeader(widget);

          return (
            <div key={widget.id}>
              <div className={`widget-card widget-type-${widget.chartType} ${!showHeader ? 'header-hidden' : ''}`}>
                {showHeader && (
                  <div className="widget-card-header widget-card-header-stack">
                    <span className="widget-card-title">{widget.title}</span>
                    {typeof widget.chartOptions?.subtitle === 'string' && widget.chartOptions.subtitle.trim() ? (
                      <span className="widget-card-subtitle">{widget.chartOptions.subtitle}</span>
                    ) : null}
                  </div>
                )}
                <div className="widget-card-body no-drag">
                  <DashboardWidgetCell
                    widget={widget}
                    dashboardId={dashboardId}
                    runtimeFilters={runtimeFilters}
                    readOnly
                    onCrossFilter={onCrossFilter}
                    onWidgetChartClick={onWidgetChartClick}
                    onRetryWidget={onRetryWidget}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}

export default DashboardViewerGrid;
