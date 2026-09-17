'use client';

import React, { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { DashboardWidgetCell } from '../DashboardWidgetCell';
import { LazyWidgetMount } from '../LazyWidgetMount';
import { shouldShowWidgetHeader } from '../../utils/widgetCardHelpers';
import { DashboardIcon } from '../../icons';
import '../../icons/IconPicker.css';
import useBreakpoint from '@/hooks/useBreakpoint';
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
  /**
   * 'preserve' keeps the Studio-authored 12-column x/y/w/h verbatim (just
   * shrinking cell width) — right for desktop/tablet. 'preview' reflows into
   * a type-aware stacked layout — right for phones, where 12 fixed columns
   * become illegibly cramped. Omit (or pass 'auto', the default) to let the
   * grid decide from actual viewport width — this was previously a real prop
   * with a real 'preview' implementation that zero call sites ever passed,
   * so every dashboard silently rendered 'preserve' on every device. An
   * explicit 'preserve' | 'preview' is still honored for a future "preview
   * as mobile" toggle in Studio.
   */
  layoutMode?: 'preserve' | 'preview' | 'auto';
  /** Passed straight through to each DashboardWidgetCell — see its own doc comment. */
  hideInteractionHint?: boolean;
  /** Mount every widget immediately (feed/embed detail). Lazy IO can miss tiles in overflow-clipped ancestors. */
  eagerMount?: boolean;
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
  canvasMinHeight = 'auto',
  layoutMode = 'auto',
  hideInteractionHint = false,
  eagerMount = false,
}: Props) {
  const screens = useBreakpoint();
  // Narrow screens: tablet (< 992px) and mobile (< 768px)
  const isNarrowScreen = screens.lg === false;
  const shouldReflow = layoutMode === 'preview' || (layoutMode === 'auto' && isNarrowScreen);

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

    if (layoutMode === 'preview') {
      return {
        lg: buildPreviewLayout(widgets, layout, 12, 2),
        md: buildPreviewLayout(widgets, layout, 10, 2),
        sm: buildPreviewLayout(widgets, layout, 6, 1),
        xs: buildPreviewLayout(widgets, layout, 4, 1),
        xxs: buildPreviewLayout(widgets, layout, 2, 1),
      };
    }

    // layoutMode === 'auto' (default):
    // Preserves desktop 12-column authored layout on large screens,
    // but reflows cleanly on tablet (10 cols, 2 per row) and mobile (1 per row)
    // so charts are spacious, legible, and easy to view.
    return {
      lg: layout,
      md: buildPreviewLayout(widgets, layout, 10, 2),
      sm: buildPreviewLayout(widgets, layout, 6, 1),
      xs: buildPreviewLayout(widgets, layout, 4, 1),
      xxs: buildPreviewLayout(widgets, layout, 2, 1),
    };
  }, [layout, layoutMode, widgets]);

  const responsiveCols = useMemo(() => {
    if (layoutMode === 'preserve') {
      return { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 };
    }
    return { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
  }, [layoutMode]);

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
        cols={responsiveCols}
        rowHeight={42}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        isDraggable={false}
        isResizable={false}
        compactType={layoutMode === 'preserve' ? null : 'vertical'}
        preventCollision={layoutMode === 'preserve'}
        useCSSTransforms
      >
        {widgets.map((widget) => {
          const showHeader = shouldShowWidgetHeader(widget);

          return (
            <div key={widget.id}>
              <div className={`widget-card widget-type-${widget.chartType} ${!showHeader ? 'header-hidden' : ''}`}>
                {showHeader && (
                  <div className="widget-card-header widget-card-header-stack">
                    <span className="widget-card-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {widget.chartOptions?.headerIcon ? (
                        <span className="widget-header-icon">
                          <DashboardIcon icon={widget.chartOptions.headerIcon} size={14} />
                        </span>
                      ) : null}
                      {widget.title}
                    </span>
                    {typeof widget.chartOptions?.subtitle === 'string' && widget.chartOptions.subtitle.trim() ? (
                      <span className="widget-card-subtitle">{widget.chartOptions.subtitle}</span>
                    ) : null}
                  </div>
                )}
                <div className="widget-card-body no-drag">
                  {eagerMount ? (
                    <DashboardWidgetCell
                      widget={widget}
                      dashboardId={dashboardId}
                      runtimeFilters={runtimeFilters}
                      readOnly
                      onCrossFilter={onCrossFilter}
                      onWidgetChartClick={onWidgetChartClick}
                      onRetryWidget={onRetryWidget}
                      hideInteractionHint={hideInteractionHint}
                    />
                  ) : (
                    <LazyWidgetMount>
                      <DashboardWidgetCell
                        widget={widget}
                        dashboardId={dashboardId}
                        runtimeFilters={runtimeFilters}
                        readOnly
                        onCrossFilter={onCrossFilter}
                        onWidgetChartClick={onWidgetChartClick}
                        onRetryWidget={onRetryWidget}
                        hideInteractionHint={hideInteractionHint}
                      />
                    </LazyWidgetMount>
                  )}
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
