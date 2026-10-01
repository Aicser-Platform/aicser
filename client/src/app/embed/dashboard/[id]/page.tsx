'use client';

import React, { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize } from '@/utils/embedMessaging';
import { useEmbedTheme } from '@/hooks/useEmbedTheme';
import { useEmbedHostCommands, useEmbedSession, type EmbedSessionState } from '@/hooks/useEmbedSession';
import { EmbedSessionGate } from '@/components/embed/EmbedSessionGate';
import type { RuntimeFilter } from '@/app/(dashboard)/dashboards/utils/filterOperators';
import { EmbedBrandingFooter } from '@/components/embed/EmbedBrandingFooter';
import { useDashboardViewerState } from '@/app/(dashboard)/dashboards/hooks/useDashboardViewerState';
import {
  DashboardViewerShell,
  ViewerLoading,
} from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerShell';
import { DashboardReportView } from '@/app/(dashboard)/dashboards/components/viewer/DashboardReportView';
import '@/app/shared/dashboards/SharedDashboard.css';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';

function EmbedDashboardContent({ dashboardId }: { dashboardId: string }) {
  const session = useEmbedSession('dashboard');
  return (
    <EmbedSessionGate session={session}>
      <EmbedDashboardView dashboardId={dashboardId} session={session} />
    </EmbedSessionGate>
  );
}

function EmbedDashboardView({ dashboardId, session }: { dashboardId: string; session: EmbedSessionState }) {
  const t = useTranslations('dashboard_viewer');
  const searchParams = useSearchParams();
  const { theme, themeStyle, dataTheme } = useEmbedTheme(session.theme);
  const [exportRequest, setExportRequest] = useState<{ format: 'png' | 'pdf'; nonce: number } | null>(null);

  const viewer = useDashboardViewerState(dashboardId, {
    mode: 'embed',
    embedToken: session.token,
    initialAutoRefreshMinutes: 0,
    onReady: (info) =>
      notifyEmbedReady({ kind: 'dashboard', dashboardId, widgetCount: info.widgetCount, download: session.download }),
    onError: (msg) => notifyEmbedError(msg, 'dashboard_load_failed'),
    onResize: (heightPx) => notifyEmbedResize(heightPx),
  });

  // The host page drives the view through the SDK (setFilters, refresh, setPage, exportImage).
  // Filters it sets narrow what the viewer sees; the embed's locked filters still apply on the
  // server whatever arrives here.
  useEmbedHostCommands(session.allowedOrigins, {
    'set-filters': (payload) => {
      const filters = (payload as { filters?: unknown } | undefined)?.filters;
      if (!Array.isArray(filters)) throw new Error('setFilters expects a list of filters');
      viewer.handleRuntimeChange(filters as RuntimeFilter[]);
    },
    refresh: () => viewer.handleManualRefresh(),
    'set-page': (payload) => {
      const pageId = (payload as { pageId?: unknown } | undefined)?.pageId;
      if (typeof pageId !== 'string' || !viewer.pages.some((p) => p.id === pageId)) {
        throw new Error('No page with that id');
      }
      viewer.handlePageSelect(pageId);
    },
    export: (payload) => {
      if (session.download === 'none') throw new Error('Downloads are turned off for this embed');
      const format = (payload as { format?: unknown } | undefined)?.format === 'pdf' ? 'pdf' : 'png';
      setExportRequest({ format, nonce: Date.now() });
    },
  });

  if (viewer.isLoading && !viewer.meta) {
    return (
      <div style={themeStyle} data-theme={dataTheme}>
        <ViewerLoading title={t('loading_title')} message={t('loading_message')} />
      </div>
    );
  }

  if (viewer.error || !viewer.meta) {
    return (
      <div style={themeStyle} data-theme={dataTheme} className="shared-dashboard-error">
        <div className="shared-dashboard-error-title">{t('not_found_title')}</div>
        <div className="shared-dashboard-error-message">{viewer.error || t('not_found_message')}</div>
      </div>
    );
  }

  if (searchParams?.get('layout') === 'report') {
    // Paginated document for PDF export (cover, KPIs, one chart per page).
    return (
      <div style={themeStyle} data-theme={dataTheme}>
        <DashboardReportView
          meta={viewer.meta}
          widgets={viewer.visibleWidgets}
          layout={viewer.visibleLayout}
          runtimeFilters={viewer.runtimeFilters}
          dashboardId={dashboardId}
        />
      </div>
    );
  }

  return (
    <div style={themeStyle} data-theme={dataTheme}>
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
        download={session.download}
        exportRequest={exportRequest}
      />
      <EmbedBrandingFooter hidden={theme?.hide_aicser_branding} />
    </div>
  );
}

export default function EmbedDashboardPage() {
  const t = useTranslations('dashboard_viewer');
  const routeParams = useParams();
  const dashboardId = typeof routeParams?.id === 'string' ? routeParams.id : '';
  return (
    <Suspense fallback={<ViewerLoading title={t('loading_title')} message="" />}>
      <EmbedDashboardContent dashboardId={dashboardId} />
    </Suspense>
  );
}
