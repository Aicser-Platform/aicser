'use client';

import { useEffect, useMemo, useRef } from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useChartDesignerStore } from '../../chart-designer/stores/useChartDesignerStore';

interface UseWidgetPropertiesParams {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  isDesigner?: boolean;
}

export const useWidgetProperties = ({
  selectedWidget,
  selectedWidgetId,
  // setWidgets is accepted for API compatibility but no longer called here —
  // all state updates go through the store's updateWidget to avoid double renders.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setWidgets: _setWidgets,
  isDesigner = false,
}: UseWidgetPropertiesParams) => {
  const normalizedDataSourceId =
    selectedWidget?.dataSourceId !== undefined && selectedWidget?.dataSourceId !== null
      ? String(selectedWidget.dataSourceId)
      : null;

  const { dataSources, isLoading } = useDataSources();
  const { schema: selectedSchemaInfo, isLoading: schemaLoading } = useDataSourceSchema(normalizedDataSourceId);

  // Use individual selectors to get stable action references.
  // Subscribing to the whole store (useDashboardStore()) causes an infinite loop:
  // any store mutation inside this hook re-renders it → new function refs → re-run effects → loop.
  const dashUpdateWidget = useDashboardStore((s) => s.updateWidget);
  const dashUpdateChartAndFetchData = useDashboardStore((s) => s.updateChartAndFetchData);
  const dashDeleteChart = useDashboardStore((s) => s.deleteChart);
  const dashFetchChartData = useDashboardStore((s) => s.fetchChartData);
  const dashCreateChartAndFetchData = useDashboardStore((s) => (s as any).createChartAndFetchData);

  const desUpdateWidget = useChartDesignerStore((s) => s.updateWidget);
  const desUpdateChartAndFetchData = useChartDesignerStore((s) => s.updateChartAndFetchData);
  const desDeleteChart = useChartDesignerStore((s) => s.deleteChart);
  const desFetchChartData = useChartDesignerStore((s) => s.fetchChartData);
  const desCreateChartAndFetchData = useChartDesignerStore((s) => s.createChartAndFetchData);

  const updateWidget = isDesigner ? desUpdateWidget : dashUpdateWidget;
  const updateChartAndFetchData = isDesigner ? desUpdateChartAndFetchData : dashUpdateChartAndFetchData;
  const deleteChart = isDesigner ? desDeleteChart : dashDeleteChart;
  const fetchChartData = isDesigner ? desFetchChartData : dashFetchChartData;
  const createChartAndFetchData = isDesigner ? desCreateChartAndFetchData : dashCreateChartAndFetchData;

  /* ----------------------------------------
   * Helpers
   * --------------------------------------*/

  const updateLocalAndStore = (patch: Partial<any>) => {
    if (!selectedWidgetId) return;
    const updatedWidget = { ...selectedWidget, ...patch };
    // Only update via the store — the store already keeps `widgets` in sync.
    // Calling setWidgets() here in addition caused a second render cycle that
    // fed back into the loop (store update → re-render → new refs → effects rerun).
    updateWidget(selectedWidgetId, updatedWidget);
    return updatedWidget;
  };

  const ensureChartQueryDefaults = (query: any = {}) => ({
    ...query,
    yMetric: query.yMetric ?? 'count',
    yMetrics: query.yMetrics ?? [],
    sortBy: query.sortBy ?? 'x',
  });

  /* ----------------------------------------
   * Effects
   * --------------------------------------*/


  // Debounced auto create / update chart with query hash check (chartQuery only)
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const isScatter = selectedWidget?.chartType === 'scatter';
    const hasX = isScatter ? !!selectedWidget?.chartQuery?.xMetrics?.[0]?.field : !!selectedWidget?.chartQuery?.x;
    const hasY = isScatter ? !!selectedWidget?.chartQuery?.yMetrics?.[0]?.field : true;

    // Compute a hash of the current query only (not chartOptions)
    const currentQueryHash = stableStringify({
      chartQuery: selectedWidget?.chartQuery,
    });

    // Only fetch if chartData is missing, widget is loading/error, or query changed
    const hasValidData =
      !!selectedWidget?.chartData &&
      !selectedWidget?.isLoading &&
      !selectedWidget?.error &&
      selectedWidget?.lastFetchedQueryHash === currentQueryHash;

    const isTextWidget = selectedWidget?.chartType === 'text';
    const canSync = isTextWidget || (selectedWidget?.dataSourceId && hasX && (!isScatter || hasY));

    if (!selectedWidgetId || !canSync || hasValidData) {
      return;
    }

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      const syncChart = async () => {
        try {
          if (!selectedWidget.chartId) {
            if (createChartAndFetchData) {
              await createChartAndFetchData({ ...selectedWidget, lastFetchedQueryHash: currentQueryHash });
            } else if (isDesigner) {
              await updateChartAndFetchData(selectedWidgetId, {
                ...selectedWidget,
                lastFetchedQueryHash: currentQueryHash,
              });
            }
          } else {
            await updateChartAndFetchData(selectedWidgetId, {
              dataSourceId: selectedWidget.dataSourceId,
              title: selectedWidget.title,
              chartQuery: selectedWidget.chartQuery,
              lastFetchedQueryHash: currentQueryHash,
            });
          }
        } catch (err) {
          console.error('Chart sync failed:', err);
        }
      };
      syncChart();
    }, 1000); // 1000ms debounce (Increased from 300ms)

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [
    selectedWidgetId,
    selectedWidget?.dataSourceId,
    selectedWidget?.chartQuery?.x,
    selectedWidget?.chartQuery?.sortBy,
    selectedWidget?.chartQuery?.yMetric,
    JSON.stringify(selectedWidget?.chartQuery?.yMetrics),
    JSON.stringify(selectedWidget?.chartQuery?.yMetricsSecondary),
    selectedWidget?.chartQuery?.aggregate,
    selectedWidget?.chartQuery?.y,
    JSON.stringify(selectedWidget?.chartQuery?.xMetrics),
    selectedWidget?.chartQuery?.legend,
    JSON.stringify(selectedWidget?.chartQuery?.filters),
    selectedWidget?.chartQuery?.tableName,
    JSON.stringify(selectedWidget?.chartQuery?.metricFilters),
    selectedWidget?.chartQuery?.sortOrder,
    selectedWidget?.chartQuery?.limit,
    selectedWidget?.chartQuery?.seriesLimit,
    selectedWidget?.title, // DEBOUNCE TITLE CHANGES
  ]);

  /* ----------------------------------------
   * Selectors
   * --------------------------------------*/

  const selectedTableColumns = useMemo(() => {
    if (!selectedSchemaInfo || !selectedSchemaInfo.tables) return [];

    const selectedTableName = (selectedWidget as any)?.chartQuery?.tableName;

    // Find the specific table if selected, else default to 'data' or the first usable one
    const table =
      (selectedTableName ? selectedSchemaInfo.tables.find((t: any) => t.name === selectedTableName) : null) ||
      selectedSchemaInfo.tables.find((t: any) => t.name === 'data') ||
      selectedSchemaInfo.tables.find((t: any) => t.columns && t.columns.length > 0) ||
      selectedSchemaInfo.tables[0];

    return (
      table?.columns?.map((c: any) => ({
        label: c.name || c,
        value: c.name || c,
        type: c.type || 'string',
      })) ?? []
    );
  }, [selectedSchemaInfo, (selectedWidget as any)?.chartQuery?.tableName]);

  /* ----------------------------------------
   * Public API
   * --------------------------------------*/

  // Debounce for chartOptions API update
  const chartOptionsDebounce = useRef<NodeJS.Timeout | null>(null);
  const updateWidgetRoot = (key: string, value: any) => {
    // If chartOptions (UI only), update UI instantly and debounce API update
    if (key === 'chartOptions') {
      updateLocalAndStore({ chartOptions: value });
      if (chartOptionsDebounce.current) {
        clearTimeout(chartOptionsDebounce.current);
      }
      if (selectedWidget?.chartId && selectedWidgetId) {
        chartOptionsDebounce.current = setTimeout(() => {
          updateChartAndFetchData(selectedWidgetId, {
            chartOptions: value,
          });
        }, 1200); // 1200ms debounce (Increased from 400ms)
      }
      return;
    }

    // If chartQuery (data-affecting), update and trigger normal flow
    const updated = updateLocalAndStore({ [key]: value });
    if (key === 'chartQuery' && updated) {
      updateLocalAndStore({
        chartQuery: ensureChartQueryDefaults(updated.chartQuery),
      });
    }
  };

  const updateChartQuery = (key: string, value: any) => {
    const prevX = selectedWidget.chartQuery?.x;
    let nextQuery = ensureChartQueryDefaults({
      ...(selectedWidget.chartQuery || {}),
      [key]: value,
    });

    // Smart default: if x is selected and yMetrics is empty or only contained the previous default x
    // then update yMetrics to count(newX)
    const isPie = selectedWidget?.chartType === 'pie';
    const isXChange = key === 'x';
    const hasNoMetrics = !nextQuery.yMetrics || nextQuery.yMetrics.length === 0;
    const wasUsingDefaultX =
      nextQuery.yMetrics?.length === 1 &&
      nextQuery.yMetrics[0].field === prevX &&
      nextQuery.yMetrics[0].aggregation === 'count';

    if (isXChange && value && (hasNoMetrics || wasUsingDefaultX)) {
      nextQuery = {
        ...nextQuery,
        yMetrics: [{ field: value, aggregation: 'count' }],
      };
    }

    // Auto title for scatter - Removed as per user request to keep title as chart type name
    updateLocalAndStore({ chartQuery: nextQuery });
  };

  const handleDataSourceChange = (dataSourceId: string) => {
    // Reset chart query when switching data source to avoid stale column selections
    updateLocalAndStore({
      dataSourceId,
      chartQuery: { yMetric: 'count', yMetrics: [], sortBy: 'x' },
    });

    // React Query will auto-fetch schema for the new normalizedDataSourceId
  };

  const handleRefreshData = async () => {
    if (selectedWidgetId) {
      await fetchChartData(selectedWidgetId);
    }
  };

  const handleDeleteChart = async () => {
    if (!selectedWidgetId) return;

    await deleteChart(selectedWidgetId);

    updateLocalAndStore({
      chartId: null,
      chartData: null,
    });
  };

  return {
    dataSources,
    selectedTableColumns,
    availableTables: selectedSchemaInfo?.tables?.map((t: any) => t.name) || [],
    hasChart: !!selectedWidget?.chartId,
    isLoading,
    schemaLoading,
    updateWidgetRoot,
    updateChartQuery,
    handleDataSourceChange,
    handleRefreshData,
    handleDeleteChart,
  };
};
