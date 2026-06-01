'use client';

import React from 'react';
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
  onWidgetChartClick?: (
    widget: WidgetInstance,
    field: string,
    value: unknown,
    shiftKey: boolean,
  ) => void;
  onRetryWidget?: (widgetId: string) => void;
  refreshing?: boolean;
  canvasMinHeight?: string;
};

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
}: Props) {
  return (
    <div className="dashboard-canvas-wrapper dashboard-viewer-canvas" style={{ minHeight: canvasMinHeight }}>
      <ResponsiveGridLayout
        className="layout"
        style={{ opacity: refreshing ? 0.72 : 1, transition: 'opacity 0.2s ease' }}
        layouts={{
          lg: layout.map((item) => ({ ...item, static: true })),
          md: layout.map((item) => ({ ...item, static: true })),
          sm: layout.map((item) => ({ ...item, static: true })),
          xs: layout.map((item) => ({ ...item, static: true })),
          xxs: layout.map((item) => ({ ...item, static: true })),
        }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
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
              <div
                className={`widget-card widget-type-${widget.chartType} ${!showHeader ? 'header-hidden' : ''}`}
              >
                {showHeader && (
                  <div className="widget-card-header widget-card-header-stack">
                    <span className="widget-card-title">{widget.title}</span>
                    {typeof widget.chartOptions?.subtitle === 'string' &&
                    widget.chartOptions.subtitle.trim() ? (
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
