'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { useTranslations } from 'next-intl';
import { DEFAULT_AUTO_REFRESH_MINUTES, formatLastRefreshed, type RefreshResult } from '../utils/dashboardRefresh';

export const AUTO_REFRESH_INTERVAL_OPTIONS = [0, 5, 15, 30] as const;

type Options = {
  /** Returns widget ids to refresh (visible page widgets). */
  getTargetIds: () => string[];
  refreshWidgets: (widgetIds?: string[]) => Promise<RefreshResult>;
  autoRefreshMinutes?: number;
  /** Auto-enable periodic refresh in view mode. */
  defaultAutoRefreshInView?: boolean;
  studioMode?: 'edit' | 'view';
};

export function useDashboardRefresh({
  getTargetIds,
  refreshWidgets,
  autoRefreshMinutes: defaultMinutes = DEFAULT_AUTO_REFRESH_MINUTES,
  defaultAutoRefreshInView = true,
  studioMode = 'edit',
}: Options) {
  const t = useTranslations('dashboards');
  const tr = useTranslations('refresh_controls');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(0);
  const getTargetIdsRef = useRef(getTargetIds);
  const refreshWidgetsRef = useRef(refreshWidgets);
  getTargetIdsRef.current = getTargetIds;
  refreshWidgetsRef.current = refreshWidgets;

  const autoRefreshEnabled = autoRefreshMinutes > 0;

  const runRefresh = useCallback(
    async (widgetIds?: string[], opts?: { silent?: boolean }) => {
      const ids = widgetIds?.length ? widgetIds : getTargetIdsRef.current();
      if (!ids.length) return { ok: 0, failed: 0, total: 0 };

      setRefreshing(true);
      try {
        const result = await refreshWidgetsRef.current(ids);
        setLastRefreshedAt(new Date());
        if (!opts?.silent) {
          if (result.failed === 0) {
            message.success(tr('dashboard_refreshed_success'));
          } else if (result.ok === 0) {
            message.error(tr('failed_refresh_dashboard'));
          } else {
            message.warning(t('refresh_partial', { ok: result.ok, failed: result.failed }));
          }
        }
        return result;
      } catch {
        if (!opts?.silent) message.error(tr('failed_refresh_dashboard'));
        return { ok: 0, failed: ids.length, total: ids.length };
      } finally {
        setRefreshing(false);
      }
    },
    [t, tr]
  );

  const handleManualRefresh = useCallback(() => runRefresh(undefined, { silent: false }), [runRefresh]);

  useEffect(() => {
    if (defaultAutoRefreshInView && studioMode === 'view') {
      setAutoRefreshMinutes(defaultMinutes);
    }
  }, [defaultAutoRefreshInView, studioMode, defaultMinutes]);

  useEffect(() => {
    if (!autoRefreshEnabled || !autoRefreshMinutes) return;
    const ms = autoRefreshMinutes * 60 * 1000;
    const id = window.setInterval(() => {
      void runRefresh(undefined, { silent: true });
    }, ms);
    return () => window.clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshMinutes, runRefresh]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !autoRefreshMinutes) return;
      const staleMs = autoRefreshMinutes * 60 * 1000;
      if (!lastRefreshedAt || Date.now() - lastRefreshedAt.getTime() >= staleMs) {
        void runRefresh(undefined, { silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [autoRefreshMinutes, lastRefreshedAt, runRefresh]);

  const lastRefreshedLabel = formatLastRefreshed(lastRefreshedAt, (key, values) => t(key, values));

  const noteRefreshComplete = useCallback(() => {
    setLastRefreshedAt(new Date());
  }, []);

  return {
    refreshing,
    lastRefreshedAt,
    lastRefreshedLabel,
    autoRefreshEnabled,
    autoRefreshMinutes,
    setAutoRefreshMinutes,
    handleManualRefresh,
    runRefresh,
    noteRefreshComplete,
  };
}
