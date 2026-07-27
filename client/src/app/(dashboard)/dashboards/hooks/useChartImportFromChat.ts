'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { message } from 'antd';
import { useTranslations } from 'next-intl';
import { useDashboardStore } from '../stores/useDashboardStore';
import {
  buildChatChartPinPayload,
  clearChartImportSession,
  peekChatLibraryChart,
  readChartImportFromSession,
  rememberChatLibraryChart,
  type ChatChartImportPayload,
} from '@/components/charts/buildChatChartPinPayload';
import { ensureLibraryChartAndPinToDashboard } from '@/components/charts/ensureLibraryChartAndPin';
import { attachSavedQueryToPinPayload } from '@/services/savedQueryBindService';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { useProjectStore } from '@/stores/useProjectStore';

export function useChartImportFromChat() {
  const t = useTranslations('dashboards_page');
  const searchParams = useSearchParams();
  const router = useRouter();
  const importRequested = searchParams?.get('import') === 'chart';
  const requestedChartId = searchParams?.get('chart');

  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const hasLoadedDashboards = useDashboardStore((s) => s.hasLoadedDashboards);
  const widgets = useDashboardStore((s) => s.widgets);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const setSelectedWidgetId = useDashboardStore((s) => s.setSelectedWidgetId);
  const setPropertiesCollapsed = useDashboardStore((s) => s.setPropertiesCollapsed);

  const [importOpen, setImportOpen] = useState(false);
  const [importPayload, setImportPayload] = useState<ChatChartImportPayload | null>(null);
  const [targetDashboardId, setTargetDashboardId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const appliedChartIdRef = useRef<string | null>(null);
  const importHandledRef = useRef(false);

  useEffect(() => {
    if (!importRequested || importHandledRef.current || !hasLoadedDashboards) return;
    const payload = readChartImportFromSession();
    if (!payload) {
      importHandledRef.current = true;
      router.replace('/dashboards');
      return;
    }
    importHandledRef.current = true;
    setImportPayload(payload);
    setTargetDashboardId(activeDashboardId ?? null);
    setImportOpen(true);
  }, [importRequested, hasLoadedDashboards, activeDashboardId, router]);

  useEffect(() => {
    if (!hasLoadedDashboards || !requestedChartId) return;
    if (appliedChartIdRef.current === requestedChartId) return;
    const widget = widgets.find((w) => String(w.chartId) === String(requestedChartId));
    if (!widget) return;
    appliedChartIdRef.current = requestedChartId;
    setSelectedWidgetId(widget.id);
    setPropertiesCollapsed(false);
  }, [
    hasLoadedDashboards,
    requestedChartId,
    widgets,
    setSelectedWidgetId,
    setPropertiesCollapsed,
  ]);

  const handleImportConfirm = useCallback(async () => {
    if (!importPayload || !targetDashboardId) {
      message.warning(t('chart_import_select_dashboard'));
      return;
    }
    setImporting(true);
    try {
      let payload = buildChatChartPinPayload(importPayload);
      const projectId = useProjectStore.getState().currentProjectId;
      payload = await attachSavedQueryToPinPayload(
        payload,
        importPayload.sqlQuery ||
          (typeof payload.chartOptions?.sample_sql === 'string'
            ? payload.chartOptions.sample_sql
            : null),
        { projectId, source: 'ai_chat_import' },
      );
      const existingChartId =
        importPayload.libraryChartId ||
        peekChatLibraryChart(importPayload.messageId) ||
        undefined;
      const pinned = await ensureLibraryChartAndPinToDashboard({
        dashboardId: targetDashboardId,
        definition: {
          title: payload.title,
          chartType: payload.chartType,
          dataSourceId: payload.dataSourceId,
          chartQuery: payload.chartQuery,
          chartOptions: payload.chartOptions,
          existingChartId: existingChartId || undefined,
          reuseSavedQuery: Boolean(
            payload.chartQuery &&
              typeof payload.chartQuery === 'object' &&
              (payload.chartQuery as { saved_query_id?: unknown }).saved_query_id,
          ),
        },
        layout: { w: 6, h: 5 },
        mode: 'link',
        projectId,
      });
      rememberChatLibraryChart(importPayload.messageId, pinned.libraryChartId);
      clearChartImportSession();
      setImportOpen(false);
      setImportPayload(null);
      await fetchDashboards();
      await useDashboardStore.getState().loadDashboardById(targetDashboardId);
      appliedChartIdRef.current = pinned.chartId;
      setSelectedWidgetId(`widget-${pinned.chartId}`);
      setPropertiesCollapsed(false);
      message.success(t('chart_import_success'));
      router.replace(`/dashboards?id=${targetDashboardId}&chart=${pinned.chartId}&mode=edit`);
    } catch (err) {
      console.error('[useChartImportFromChat]', err);
      message.error(formatApiValidationError(err));
    } finally {
      setImporting(false);
    }
  }, [
    importPayload,
    targetDashboardId,
    fetchDashboards,
    setSelectedWidgetId,
    setPropertiesCollapsed,
    router,
    t,
  ]);

  const handleImportCancel = useCallback(() => {
    clearChartImportSession();
    setImportOpen(false);
    setImportPayload(null);
    router.replace('/dashboards');
  }, [router]);

  return {
    importOpen,
    importPayload,
    targetDashboardId,
    setTargetDashboardId,
    importing,
    handleImportConfirm,
    handleImportCancel,
  };
}
