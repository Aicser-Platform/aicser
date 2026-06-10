'use client';

import { useDashboardViewerState } from './useDashboardViewerState';

/** Authenticated / shared dashboard viewer — wraps unified viewer state. */
export function useAuthDashboardViewer(
  dashboardId: string,
  options?: { embedToken?: string },
) {
  return useDashboardViewerState(dashboardId, {
    mode: 'auth',
    embedToken: options?.embedToken,
    urlSyncBasePath: '/shared/dashboards',
  });
}

export default useAuthDashboardViewer;
