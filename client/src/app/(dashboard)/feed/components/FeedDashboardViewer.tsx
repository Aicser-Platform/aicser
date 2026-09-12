'use client';

import React from 'react';
import { Empty, Spin } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useDashboardViewerState } from '@/app/(dashboard)/dashboards/hooks/useDashboardViewerState';
import { DashboardFilterPanel } from '@/app/(dashboard)/dashboards/components/DashboardFilterPanel';
import { DashboardPageTabs } from '@/app/(dashboard)/dashboards/components/DashboardPageTabs';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';
import { FeedDashboardPreviewGrid } from './FeedDashboardPreviewGrid';
import { FEED_DASHBOARD_PREVIEW_MAX } from '../utils/feedDashboardPreviewLayout';
// Same stylesheet the dashboard studio canvas and the shared/embed viewers load
// (e.g. src/app/shared/dashboards/page.tsx, src/app/embed/dashboard/[id]/page.tsx) —
// importing it here, not re-deriving widget-card/grid styling, is what keeps this
// feed viewer visually identical to the canvas and automatically in sync with it.
import '@/app/(dashboard)/dashboards/DashboardStudio.css';

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

  const cardLimit = maxWidgets ?? FEED_DASHBOARD_PREVIEW_MAX;
  const widgets = variant === 'card' ? viewer.visibleWidgets.slice(0, cardLimit) : viewer.visibleWidgets;

  const layout =
    variant === 'card'
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

  if (variant === 'card') {
    return (
      <div className="feed-dashboard-viewer feed-dashboard-viewer--card">
        {viewer.combinedFiltersConfig.length > 0 ? (
          <div className="flex items-center gap-1.5 px-1 pb-2 text-xs text-[var(--ant-color-text-tertiary)]">
            <FilterOutlined style={{ fontSize: 11 }} />
            <span>{t('card_filters_available', { count: viewer.combinedFiltersConfig.length })}</span>
          </div>
        ) : null}
        <FeedDashboardPreviewGrid
          widgets={widgets}
          maxWidgets={cardLimit}
          totalWidgetCount={viewer.visibleWidgets.length}
        />
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

      {/* The toolbar filter bar assumes page-width room (150-225px per field,
          a non-shrinking Reset button, and a wrap breakpoint keyed to the
          VIEWPORT, not this container) - correct for the 'detail' variant,
          but inside a ~300px feed grid tile or attachment card it has
          nowhere to go but a cramped horizontal scrollbar. A preview card
          previews; enterprise BI share-to-feed/Slack conventions (Looker,
          Metabase, PowerBI) show a static summary in that context and leave
          full filtering for the expanded view, which 'card' already does
          for the widget grid below - filters were the one piece still
          rendered at full interactive size regardless of variant. */}
      {viewer.combinedFiltersConfig.length > 0 && variant !== 'card' ? (
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
      ) : viewer.combinedFiltersConfig.length > 0 ? (
        <div className="flex items-center gap-1.5 px-1 pb-2 text-xs text-[var(--ant-color-text-tertiary)]">
          <FilterOutlined style={{ fontSize: 11 }} />
          <span>
            {t('card_filters_available', { count: viewer.combinedFiltersConfig.length })}
          </span>
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
        canvasMinHeight="auto"
        layoutMode="preserve"
        hideInteractionHint
        eagerMount
      />
    </div>
  );
}

export default FeedDashboardViewer;
