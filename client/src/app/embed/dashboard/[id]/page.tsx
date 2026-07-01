'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize } from '@/utils/embedMessaging';
import { useDashboardViewerState } from '@/app/(dashboard)/dashboards/hooks/useDashboardViewerState';
import {
  DashboardViewerShell,
  ViewerLoading,
} from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerShell';
import '@/app/shared/dashboards/SharedDashboard.css';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';

function EmbedDashboardContent({ dashboardId }: { dashboardId: string }) {
  const t = useTranslations('dashboard_viewer');
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const viewer = useDashboardViewerState(dashboardId, {
    mode: 'embed',
    embedToken: token,
    initialAutoRefreshMinutes: 0,
    onReady: (info) => notifyEmbedReady({ kind: 'dashboard', dashboardId, widgetCount: info.widgetCount }),
    onError: (msg) => notifyEmbedError(msg, 'dashboard_load_failed'),
    onResize: (heightPx) => notifyEmbedResize(heightPx),
  });

  if (viewer.isLoading && !viewer.meta) {
    return <ViewerLoading title={t('loading_title')} message={t('loading_message')} />;
  }

  if (viewer.error || !viewer.meta) {
    return (
      <div className="shared-dashboard-error">
        <div className="shared-dashboard-error-title">{t('not_found_title')}</div>
        <div className="shared-dashboard-error-message">{viewer.error || t('not_found_message')}</div>
      </div>
    );
  }

  return (
    <DashboardViewerShell
      meta={viewer.meta}
      pages={viewer.pages}
      activePageId={viewer.activePageId}
      onPageSelect={viewer.handlePageSelect}
      combinedFiltersConfig={viewer.combinedFiltersConfig}
      pageFilterFields={viewer.pageFilterFields}
      runtimeFilters={viewer.runtimeFilters}
      onRuntimeFiltersChange={viewer.handleRuntimeChange}
      onCrossFilter={viewer.handleCrossFilter}
      widgets={viewer.visibleWidgets}
      layout={viewer.visibleLayout}
      dashboardId={dashboardId}
      onRetryWidget={viewer.handleRetryWidget}
      onManualRefresh={viewer.handleManualRefresh}
      refreshing={viewer.refreshing}
      fetchFilterOptions={viewer.fetchFilterOptions}
      fetchFilterFieldStats={viewer.fetchFilterFieldStats}
      variant="embed"
      autoRefreshMinutes={viewer.autoRefreshMinutes}
      onAutoRefreshIntervalChange={viewer.setAutoRefreshMinutes}
      lastRefreshedLabel={viewer.lastRefreshedLabel}
    />
  );
}

export default function EmbedDashboardPage({ params }: { params: { id: string } }) {
  const t = useTranslations('dashboard_viewer');
  const dashboardId = params?.id || '';
  return (
    <Suspense fallback={<ViewerLoading title={t('loading_title')} message="" />}>
      <EmbedDashboardContent dashboardId={dashboardId} />
    </Suspense>
  );
}
