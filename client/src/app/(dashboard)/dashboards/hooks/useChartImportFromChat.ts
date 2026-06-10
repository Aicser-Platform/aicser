'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { message } from 'antd';
import { useTranslations } from 'next-intl';
import { chartService } from '../services/chartService';
import { useDashboardStore } from '../stores/useDashboardStore';
import {
  buildChatChartPinPayload,
  clearChartImportSession,
  readChartImportFromSession,
  type ChatChartImportPayload,
} from '@/components/charts/buildChatChartPinPayload';
import { sanitizeLayoutItem, maxLayoutY } from '../utils/layoutSanitize';
import { formatApiValidationError } from '@/utils/validationErrorMessage';

export function useChartImportFromChat() {
  const t = useTranslations('dashboards_page');
  const searchParams = useSearchParams();
  const router = useRouter();
  const importRequested = searchParams?.get('import') === 'chart';
  const requestedChartId = searchParams?.get('chart');

  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const hasLoadedDashboards = useDashboardStore((s) => s.hasLoadedDashboards);
  const widgets = useDashboardStore((s) => s.widgets);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
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
    setTargetDashboardId(activeDashboardId ?? dashboards[0]?.id ?? null);
    setImportOpen(true);
  }, [importRequested, hasLoadedDashboards, activeDashboardId, dashboards, router]);

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
      const payload = buildChatChartPinPayload(importPayload);
      const layoutState = useDashboardStore.getState().layout;
      const chart = await chartService.createChart(targetDashboardId, {
        dataSourceId: payload.dataSourceId,
        chartType: payload.chartType,
        title: payload.title,
        chartOptions: payload.chartOptions,
        chartQuery: payload.chartQuery,
        layout: sanitizeLayoutItem({ x: 0, y: 0, w: 6, h: 5 }, maxLayoutY(layoutState)),
      });
      clearChartImportSession();
      setImportOpen(false);
      setImportPayload(null);
      await fetchDashboards();
      setActiveDashboardId(targetDashboardId);
      appliedChartIdRef.current = String(chart.id);
      const widgetId = `widget-${chart.id}`;
      setSelectedWidgetId(widgetId);
      setPropertiesCollapsed(false);
      message.success(t('chart_import_success'));
      router.replace(`/dashboards?id=${targetDashboardId}&chart=${chart.id}`);
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
    setActiveDashboardId,
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
    dashboardOptions: dashboards.map((d) => ({ value: d.id, label: d.name })),
  };
}
