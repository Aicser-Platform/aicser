'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { message as antMessage } from 'antd';
import { useTranslations } from 'next-intl';
import { useChartDesignerStore } from '@/app/(dashboard)/chart-designer/stores/useChartDesignerStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  buildDesignerWidgetFromChat,
  markChartDesignerSelection,
  prepareChartOptionsForPersist,
  storePendingChartDesignerImport,
  storeTempChartData,
} from '@/components/charts/chartDesignerBridge';
import type { ChatMessagePinSource } from '@/components/charts/buildChatChartPinPayload';
import { rememberChatLibraryChart } from '@/components/charts/buildChatChartPinPayload';
import type { SharedChartProps } from '@/components/charts/echartsToSharedWidget';
import { chartBuilderService } from '@/app/(dashboard)/chart-designer/services/chartBuilderService';
import { attachSavedQueryToPinPayload } from '@/services/savedQueryBindService';
import { formatApiValidationError, isValidUuid } from '@/utils/validationErrorMessage';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export function useOpenChartDesignerFromChat() {
  const t = useTranslations('chat_page');
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const saveChart = useChartDesignerStore((s) => s.saveChart);

  const openInDesigner = useCallback(
    async (params: {
      source: ChatMessagePinSource;
      dataSourceId?: string | null;
      title?: string;
      sharedChartProps?: SharedChartProps | null;
    }) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        antMessage.warning(t('login_required_charts'));
        return;
      }

      const hasChart = !!(params.source.echartsConfig || params.source.chartConfig);
      if (!hasChart) {
        antMessage.warning(t('customize_chart_failed'));
        return;
      }

      if (isEnterpriseEdition) {
        const projectId = useProjectStore.getState().currentProjectId;
        if (!isValidUuid(projectId != null ? String(projectId) : null)) {
          antMessage.error(t('project_required_charts'));
          return;
        }
      }

      const dsId = params.dataSourceId ?? params.source.dataSourceId ?? null;

      setOpening(true);
      try {
        let widgetToSave = buildDesignerWidgetFromChat(params.source, {
          userId,
          title: params.title,
          sharedChartProps: params.sharedChartProps,
          dataSourceIdOverride: dsId,
        });

        const projectId = useProjectStore.getState().currentProjectId;
        const enriched = await attachSavedQueryToPinPayload(
          {
            title: widgetToSave.title,
            chartQuery: (widgetToSave.chartQuery || {}) as Record<string, unknown>,
            chartOptions: (widgetToSave.chartOptions || {}) as Record<string, unknown>,
            dataSourceId: widgetToSave.dataSourceId ?? null,
          },
          params.source.sqlQuery,
          { projectId, source: 'ai_chat_customize' },
        );
        widgetToSave = {
          ...widgetToSave,
          chartQuery: enriched.chartQuery as typeof widgetToSave.chartQuery,
          chartOptions: enriched.chartOptions as typeof widgetToSave.chartOptions,
        };

        const reuseSavedQuery = Boolean(
          widgetToSave.chartQuery &&
            typeof widgetToSave.chartQuery === 'object' &&
            (widgetToSave.chartQuery as { saved_query_id?: unknown }).saved_query_id,
        );

        // Prefer existing library chart for this message; else upsert
        let chartId: string | null = params.source.libraryChartId
          ? String(params.source.libraryChartId)
          : widgetToSave.chartId
            ? String(widgetToSave.chartId)
            : null;
        if (!chartId) {
          const created = await chartBuilderService.createChart(
            {
              title: widgetToSave.title,
              chartType: widgetToSave.chartType,
              dataSourceId: widgetToSave.dataSourceId ?? null,
              chartQuery: widgetToSave.chartQuery || {},
              chartOptions: prepareChartOptionsForPersist(widgetToSave.chartOptions),
              reuseSavedQuery,
            },
            projectId,
          );
          chartId = created?.id ? String(created.id) : null;
        } else if (!params.source.libraryChartId) {
          chartId = await saveChart(widgetToSave, userId);
        }

        if (!chartId) {
          antMessage.error(t('customize_chart_failed'));
          return;
        }

        rememberChatLibraryChart(params.source.messageId, chartId);

        const savedWidget = {
          ...widgetToSave,
          id: `w_saved_${chartId}`,
          chartId,
        };
        const chartData = params.sharedChartProps?.chartData ?? widgetToSave.chartData ?? null;

        if (chartData) {
          storeTempChartData(chartId, chartData);
        }

        storePendingChartDesignerImport({
          chartId,
          widget: savedWidget,
          chartData,
        });

        markChartDesignerSelection(chartId);
        antMessage.success(t('customize_chart_opening'));
        router.push(`/chart-designer?chart=${encodeURIComponent(chartId)}`);
      } catch (err) {
        console.error('[useOpenChartDesignerFromChat]', err);
        antMessage.error(formatApiValidationError(err) || t('customize_chart_failed'));
      } finally {
        setOpening(false);
      }
    },
    [router, saveChart, t],
  );

  return { openInDesigner, opening };
}
