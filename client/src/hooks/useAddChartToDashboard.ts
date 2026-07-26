'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { message as antMessage } from 'antd';
import { useTranslations } from 'next-intl';
import { useDashboardStore } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import { chartService } from '@/app/(dashboard)/dashboards/services/chartService';
import {
  buildChatChartPinPayload,
  type ChatMessagePinSource,
} from '@/components/charts/buildChatChartPinPayload';
import { prepareChartOptionsForPersist } from '@/components/charts/chartDesignerBridge';
import { sanitizeLayoutItem, maxLayoutY } from '@/app/(dashboard)/dashboards/utils/layoutSanitize';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { useProjectStore } from '@/stores/useProjectStore';

export const CREATE_NEW_DASHBOARD_ID = '__create_new__';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

function isValidUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function useAddChartToDashboard() {
  const t = useTranslations('chat');
  const router = useRouter();
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const setSelectedWidgetId = useDashboardStore((s) => s.setSelectedWidgetId);
  const setPropertiesCollapsed = useDashboardStore((s) => s.setPropertiesCollapsed);

  const [open, setOpen] = useState(false);
  const [modalDashboards, setModalDashboards] = useState<Array<{ id: string; label: string }>>([]);
  const [targetDashboardId, setTargetDashboardId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [pendingSource, setPendingSource] = useState<{
    source: ChatMessagePinSource;
    dataSourceId?: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const suggestDashboardName = useCallback(
    (source: ChatMessagePinSource) => {
      try {
        const payload = buildChatChartPinPayload(source, source.dataSourceId ?? null);
        const title = (payload.title || source.title || '').trim();
        if (title) return title.length > 60 ? `${title.slice(0, 57)}…` : title;
      } catch {
        /* use fallback */
      }
      return t('pin_dashboard_new_default_name');
    },
    [t],
  );

  const openModal = useCallback(
    async (source: ChatMessagePinSource, dataSourceId?: string | null) => {
      if (isEnterpriseEdition) {
        const projectId = useProjectStore.getState().currentProjectId;
        if (!isValidUuid(projectId != null ? String(projectId) : null)) {
          antMessage.error(t('pin_dashboard_project_required'));
          return;
        }
      }

      let dashboardList = useDashboardStore.getState().dashboards;
      if (dashboardList.length === 0) {
        try {
          await fetchDashboards();
          dashboardList = useDashboardStore.getState().dashboards;
        } catch {
          antMessage.error(t('pin_dashboard_load_failed'));
          return;
        }
      }

      const suggestedName = suggestDashboardName(source);
      const isEmpty = dashboardList.length === 0;

      setModalDashboards(dashboardList.map((d) => ({ id: d.id, label: d.name })));
      setCreatingNew(isEmpty);
      setNewDashboardName(suggestedName);

      if (isEmpty) {
        setTargetDashboardId(CREATE_NEW_DASHBOARD_ID);
      } else {
        const activeId = useDashboardStore.getState().activeDashboardId ?? activeDashboardId;
        setTargetDashboardId(activeId ?? dashboardList[0]?.id ?? null);
      }

      setPendingSource({ source, dataSourceId });
      setOpen(true);
    },
    [activeDashboardId, fetchDashboards, suggestDashboardName, t],
  );

  const closeModal = useCallback(() => {
    setOpen(false);
    setPendingSource(null);
    setCreatingNew(false);
    setNewDashboardName('');
  }, []);

  const handleTargetChange = useCallback((id: string) => {
    if (id === CREATE_NEW_DASHBOARD_ID) {
      setCreatingNew(true);
      setTargetDashboardId(CREATE_NEW_DASHBOARD_ID);
      return;
    }
    setCreatingNew(false);
    setTargetDashboardId(id);
  }, []);

  const confirmAdd = useCallback(async () => {
    if (!pendingSource) return;

    const needsCreate =
      creatingNew ||
      targetDashboardId === CREATE_NEW_DASHBOARD_ID ||
      !targetDashboardId ||
      modalDashboards.length === 0;

    let dashboardId = targetDashboardId;

    if (needsCreate) {
      const name = newDashboardName.trim();
      if (!name) {
        antMessage.warning(t('pin_dashboard_name_required'));
        return;
      }
    } else if (!dashboardId) {
      antMessage.warning(t('pin_dashboard_select_required'));
      return;
    }

    setSubmitting(true);
    try {
      if (needsCreate) {
        dashboardId = await addDashboard(newDashboardName.trim());
      }

      const payload = buildChatChartPinPayload(
        pendingSource.source,
        pendingSource.dataSourceId ?? pendingSource.source.dataSourceId ?? null,
      );
      const layoutState = needsCreate ? [] : useDashboardStore.getState().layout;
      const chart = await chartService.createChart(dashboardId!, {
        dataSourceId: payload.dataSourceId,
        chartType: payload.chartType,
        title: payload.title,
        // Same cleanup the Chart Designer save path applies (strips __animate,
        // removes watermark graphics from any embedded snapshot) — this path
        // built its payload independently and was skipping it, so a pinned
        // chart's stored options carried transient/render-only fields the
        // designer path already knows to drop. Does NOT strip
        // __prefetchedChartData (see prepareChartOptionsForPersist's own doc).
        chartOptions: prepareChartOptionsForPersist(payload.chartOptions),
        chartQuery: payload.chartQuery,
        layout: sanitizeLayoutItem({ x: 0, y: 0, w: 6, h: 5 }, maxLayoutY(layoutState)),
      });

      await fetchDashboards();
      setActiveDashboardId(dashboardId!);
      setSelectedWidgetId(`widget-${chart.id}`);
      setPropertiesCollapsed(false);
      antMessage.success(
        needsCreate && modalDashboards.length === 0
          ? t('pin_dashboard_created_and_added')
          : t('pin_dashboard_success'),
      );
      setOpen(false);
      setPendingSource(null);
      setCreatingNew(false);
      setNewDashboardName('');
      router.push(`/dashboards?id=${dashboardId}&chart=${chart.id}`);
    } catch (err) {
      console.error('[useAddChartToDashboard]', err);
      antMessage.error(formatApiValidationError(err) || t('pin_dashboard_failed'));
    } finally {
      setSubmitting(false);
    }
  }, [
    pendingSource,
    targetDashboardId,
    creatingNew,
    newDashboardName,
    modalDashboards.length,
    addDashboard,
    fetchDashboards,
    setActiveDashboardId,
    setSelectedWidgetId,
    setPropertiesCollapsed,
    router,
    t,
  ]);

  return {
    open,
    modalDashboards,
    targetDashboardId,
    setTargetDashboardId: handleTargetChange,
    creatingNew,
    newDashboardName,
    setNewDashboardName,
    submitting,
    openModal,
    closeModal,
    confirmAdd,
  };
}
