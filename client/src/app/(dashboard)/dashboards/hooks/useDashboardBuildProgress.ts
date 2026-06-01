'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chartService } from '../services/chartService';
import { clearDashboardLiveBuild, isDashboardLiveBuild } from '../utils/dashboardLiveBuildStorage';
import {
  applyDashboardBuildProgressEvent,
  isTerminalDashboardBuildStatus,
  type DashboardBuildProgress,
} from '../utils/dashboardBuildEvents';

export type { DashboardBuildProgress, DashboardBuildWidget } from '../utils/dashboardBuildEvents';

const POLL_FALLBACK_MS = 4000;

export function useDashboardBuildProgress(
  dashboardId: string | null | undefined,
  enabled: boolean,
) {
  const [progress, setProgress] = useState<DashboardBuildProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [transport, setTransport] = useState<'sse' | 'poll' | null>(null);
  const lastWidgetCountRef = useRef(0);

  const applyEvent = useCallback((raw: unknown) => {
    setProgress((prev) => {
      const next = applyDashboardBuildProgressEvent(prev, raw);
      if (next?.dashboard_id && isTerminalDashboardBuildStatus(next.status)) {
        clearDashboardLiveBuild(next.dashboard_id);
      }
      return next;
    });
  }, []);

  const fetchProgress = useCallback(async (): Promise<DashboardBuildProgress | null> => {
    if (!dashboardId) return null;
    try {
      const data = (await chartService.getDashboardBuildProgress(dashboardId)) as DashboardBuildProgress;
      applyEvent(data);
      return data;
    } catch {
      return null;
    }
  }, [dashboardId, applyEvent]);

  useEffect(() => {
    if (!enabled || !dashboardId) {
      setProgress(null);
      setIsConnected(false);
      setTransport(null);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    const schedulePollFallback = () => {
      if (cancelled) return;
      pollTimer = setTimeout(async () => {
        if (cancelled) return;
        setTransport('poll');
        const data = await fetchProgress();
        if (cancelled) return;
        const stillActive =
          Boolean(data?.active) ||
          data?.status === 'building' ||
          isDashboardLiveBuild(dashboardId);
        if (stillActive && !isTerminalDashboardBuildStatus(data?.status)) {
          schedulePollFallback();
        } else {
          setIsConnected(false);
        }
      }, POLL_FALLBACK_MS);
    };

    const start = async () => {
      setIsConnected(true);
      try {
        setTransport('sse');
        await chartService.subscribeDashboardBuildProgress(
          dashboardId,
          (event) => {
            if (cancelled) return;
            applyEvent(event);
            const eventObj = event as Record<string, unknown>;
            const status = eventObj.status;
            const eventType = String(eventObj.type ?? eventObj.event_type ?? '');
            if (
              isTerminalDashboardBuildStatus(status) ||
              (eventType === 'dashboard_build_progress' && eventObj.active === false)
            ) {
              setIsConnected(false);
            }
          },
          abort.signal,
        );
      } catch {
        if (!cancelled) {
          setTransport('poll');
          schedulePollFallback();
        }
      } finally {
        if (!cancelled && !isDashboardLiveBuild(dashboardId)) {
          setIsConnected(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      abort.abort();
      if (pollTimer) clearTimeout(pollTimer);
      setIsConnected(false);
      setTransport(null);
    };
  }, [dashboardId, enabled, applyEvent, fetchProgress]);

  const readyCount = progress?.widgets_ready?.filter((w) => w.status !== 'failed').length ?? 0;
  const hasNewWidgets = readyCount > lastWidgetCountRef.current;

  useEffect(() => {
    lastWidgetCountRef.current = readyCount;
  }, [readyCount]);

  return {
    progress,
    isConnected,
    transport,
    isBuilding: Boolean(progress?.active || progress?.status === 'building'),
    readyCount,
    hasNewWidgets,
    refetch: fetchProgress,
  };
}
