'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAuthDashboardViewer } from '@/app/(dashboard)/dashboards/hooks/useAuthDashboardViewer';
import {
  DashboardViewerShell,
  DashboardViewerError,
  ViewerLoading,
} from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerShell';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';
import './SharedDashboard.css';
import { navigateToStudio } from '@/app/(dashboard)/dashboards/utils/studioNavigation';

function SharedDashboardContent() {
  const t = useTranslations('dashboard_viewer');
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const dashboardId = searchParams?.get('id') || '';
  const embedToken = searchParams?.get('token') || undefined;

  const viewer = useAuthDashboardViewer(dashboardId, { embedToken });

  const goHome = () => {
    if (isAuthenticated) {
      navigateToStudio(dashboardId);
    } else {
      router.push('/login');
    }
  };

  if (!dashboardId) {
    return (
      <DashboardViewerError
        title={t('no_id_title')}
        message={t('no_id_message')}
        onAction={goHome}
        actionLabel={isAuthenticated ? t('go_to_studio') : t('sign_in')}
      />
    );
  }

  if (viewer.isLoading && !viewer.meta) {
    return <ViewerLoading title={t('loading_title')} message={t('loading_message')} />;
  }

  if (viewer.error || !viewer.meta) {
    return (
      <DashboardViewerError
        title={t('not_found_title')}
        message={viewer.error || t('not_found_message')}
        onAction={goHome}
        actionLabel={isAuthenticated ? t('go_to_studio') : t('sign_in')}
      />
    );
  }

  return (
    <DashboardViewerShell
      meta={viewer.meta}
      pages={viewer.pages}
      activePageId={viewer.activePageId}
      onPageSelect={viewer.handlePageSelect}
      combinedFiltersConfig={viewer.combinedFiltersConfig}
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
      autoRefreshMinutes={viewer.autoRefreshMinutes}
      onAutoRefreshIntervalChange={(m) => viewer.setAutoRefreshMinutes(m)}
      lastRefreshedLabel={viewer.lastRefreshedLabel}
      pageFilterFields={viewer.pageFilterFields}
      variant="shared"
    />
  );
}

export default function SharedDashboardPage() {
  const t = useTranslations('dashboard_viewer');
  return (
    <Suspense fallback={<ViewerLoading title={t('loading_title')} message="" />}>
      <SharedDashboardContent />
    </Suspense>
  );
}
