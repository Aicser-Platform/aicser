'use client';

import React from 'react';
import { Empty, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useDashboardViewerState } from '@/app/(dashboard)/dashboards/hooks/useDashboardViewerState';
import { DashboardFilterPanel } from '@/app/(dashboard)/dashboards/components/DashboardFilterPanel';
import { DashboardPageTabs } from '@/app/(dashboard)/dashboards/components/DashboardPageTabs';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';

type Props = {
  dashboardId: string;
  /** Feed cards use a tighter layout; detail page uses full grid. */
  variant?: 'card' | 'detail';
  maxWidgets?: number;
  onReady?: (info: { widgetCount: number }) => void;
};

/**
 * Read-only dashboard renderer for /feed — same data path as shared/embed viewers
 * (layout, pages, filters, batch refresh) instead of ad-hoc WidgetPreview grids.
 */
export function FeedDashboardViewer({ dashboardId, variant = 'detail', maxWidgets, onReady }: Props) {
  const t = useTranslations('feed');
  const viewer = useDashboardViewerState(dashboardId, {
    mode: 'auth',
    initialAutoRefreshMinutes: 0,
    onReady,
  });

  const widgets =
    variant === 'card' && maxWidgets
      ? viewer.visibleWidgets.slice(0, maxWidgets)
      : viewer.visibleWidgets;

  const layout =
    variant === 'card' && maxWidgets
      ? viewer.visibleLayout.filter((l) => widgets.some((w) => w.id === l.i))
      : viewer.visibleLayout;

  if (viewer.isLoading) {
    return (
      <div className="feed-dashboard-viewer feed-dashboard-viewer--loading">
        <Spin tip={t('detail_loading_dashboard')} />
      </div>
    );
  }

  if (viewer.error) {
    return (
      <div className="feed-dashboard-viewer feed-dashboard-viewer--error">
        <Empty description={viewer.error || t('detail_err_dashboard')} />
      </div>
    );
  }

  if (!widgets.length) {
    return (
      <div className="feed-dashboard-viewer feed-dashboard-viewer--empty">
        <Empty description={t('detail_no_charts')} />
      </div>
    );
  }

  return (
    <div className={`feed-dashboard-viewer feed-dashboard-viewer--${variant}`}>
      {viewer.pages.length > 1 ? (
        <div className="feed-dashboard-viewer-pages">
          <DashboardPageTabs
            pages={viewer.pages}
            activePageId={viewer.activePageId}
            onSelect={viewer.handlePageSelect}
            readOnly
            showEmptyPlaceholder={false}
          />
        </div>
      ) : null}

      {viewer.combinedFiltersConfig.length > 0 ? (
        <div className="feed-dashboard-viewer-filters">
          <DashboardFilterPanel
            variant="toolbar"
            filters={viewer.combinedFiltersConfig}
            runtimeFilters={viewer.runtimeFilters}
            onChange={viewer.handleRuntimeChange}
            fetchOptions={viewer.fetchFilterOptions}
            minimal
            showHeader={false}
          />
        </div>
      ) : null}

      <DashboardViewerGrid
        widgets={widgets}
        layout={layout}
        dashboardId={dashboardId}
        runtimeFilters={viewer.runtimeFilters}
        onCrossFilter={viewer.handleCrossFilter}
        onRetryWidget={viewer.handleRetryWidget}
        refreshing={viewer.refreshing}
        canvasMinHeight={variant === 'card' ? '280px' : '480px'}
      />
    </div>
  );
}

export default FeedDashboardViewer;
