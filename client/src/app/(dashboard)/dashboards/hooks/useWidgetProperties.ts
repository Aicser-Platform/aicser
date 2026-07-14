'use client';

import { useEffect, useMemo, useRef } from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useChartDesignerStore } from '../../chart-designer/stores/useChartDesignerStore';
import type { DashboardFieldDragPayload } from '../utils/dashboardFieldDrag';

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

  const fieldName = (field?: unknown) => String(field || '').split('.').pop() || '';

  const tableColumnsFor = (tableName?: string) => {
    const tables = selectedSchemaInfo?.tables || [];
    const bare = (name?: string) => String(name || '').split('.').pop();
    const table =
      tables.find((t: any) => bare(t?.name) === bare(tableName)) ||
      tables.find((t: any) => t?.name === 'data') ||
      tables.find((t: any) => t?.columns?.length) ||
      tables[0];
    return (table?.columns || []).map((column: any) => ({
      name: String(column?.name || column?.column_name || column || ''),
      type: String(column?.type || column?.data_type || ''),
    })).filter((column: { name: string }) => column.name);
  };

  const sanitizeQueryForTable = (query: any, tableName?: string) => {
    const columns = tableColumnsFor(tableName);
    const columnNames = new Set(columns.map((column: { name: string }) => column.name.toLowerCase()));
    if (!columnNames.size) {
      return {
        ...query,
        tableName,
        joins: [],
        compiled_semantic_sql: undefined,
        saved_query_id: undefined,
      };
    }

    const hasColumn = (field?: unknown) => {
      const name = fieldName(field).toLowerCase();
      return Boolean(name && columnNames.has(name));
    };
    const firstDimension =
      columns.find((column: { name: string; type: string }) => !/(int|float|double|decimal|numeric|number|real)/i.test(column.type))?.name ||
      columns[0]?.name;
    const metricFallback = query.x && hasColumn(query.x) ? fieldName(query.x) : firstDimension;
    const next: any = { ...query, tableName, joins: [] };

    delete next.compiled_semantic_sql;
    delete next.semantic_query_spec;
    delete next.semantic_metric_id;
    delete next.semantic_dimension_ids;
    delete next.saved_query_id;

    for (const key of ['x', 'y', 'legend', 'groupField', 'sortBy']) {
      if (next[key] && next[key] !== 'x' && next[key] !== 'y' && next[key] !== 'record_order' && !hasColumn(next[key])) {
        delete next[key];
      } else if (next[key] && hasColumn(next[key])) {
        next[key] = fieldName(next[key]);
      }
    }

    next.yMetrics = Array.isArray(next.yMetrics)
      ? next.yMetrics
          .filter((metric: any) => metric?.field && hasColumn(metric.field))
          .map((metric: any) => ({ ...metric, field: fieldName(metric.field) }))
      : [];
    next.yMetricsSecondary = Array.isArray(next.yMetricsSecondary)
      ? next.yMetricsSecondary
          .filter((metric: any) => metric?.field && hasColumn(metric.field))
          .map((metric: any) => ({ ...metric, field: fieldName(metric.field) }))
      : [];
    next.filters = Array.isArray(next.filters)
      ? next.filters
          .filter((filter: any) => !filter?.field || hasColumn(filter.field))
          .map((filter: any) => filter?.field ? { ...filter, field: fieldName(filter.field) } : filter)
      : [];

    if (!next.x && selectedWidget?.chartType !== 'stat' && selectedWidget?.chartType !== 'gauge') {
      next.x = firstDimension;
    }
    if (!next.yMetrics.length) {
      next.yMetrics = metricFallback ? [{ field: metricFallback, aggregation: 'count' }] : [];
    }
    return next;
  };

  /* ----------------------------------------
   * Effects
   * --------------------------------------*/


  // Debounced auto create / update chart with query hash check (chartQuery only)
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const isScatter = selectedWidget?.chartType === 'scatter';
    const isMetricOnlyWidget =
      selectedWidget?.chartType === 'stat' || selectedWidget?.chartType === 'gauge';
    const firstMetric = selectedWidget?.chartQuery?.yMetrics?.[0];
    const hasMetric =
      Boolean(firstMetric?.field) ||
      selectedWidget?.chartQuery?.yMetric === 'count' ||
      Boolean(selectedWidget?.chartQuery?.aggregate);
    const hasX = isScatter
      ? !!selectedWidget?.chartQuery?.xMetrics?.[0]?.field
      : isMetricOnlyWidget
        ? true
        : !!selectedWidget?.chartQuery?.x;
    const hasY = isScatter
      ? !!selectedWidget?.chartQuery?.yMetrics?.[0]?.field
      : isMetricOnlyWidget
        ? hasMetric
        : true;
    const hasTable = Boolean(selectedWidget?.chartQuery?.tableName);

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
    const hasFailedCurrentQuery =
      !!selectedWidget?.error &&
      !selectedWidget?.isLoading &&
      selectedWidget?.lastFetchedQueryHash === currentQueryHash;

    const isTextWidget = selectedWidget?.chartType === 'text';
    const canSync =
      isTextWidget ||
      (selectedWidget?.dataSourceId &&
        hasX &&
        hasY &&
        (!isMetricOnlyWidget || hasTable));

    if (!selectedWidgetId || !canSync || hasValidData || hasFailedCurrentQuery) {
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
    selectedWidget?.chartType,
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
    JSON.stringify(selectedWidget?.chartQuery?.joins),
    selectedWidget?.title, // DEBOUNCE TITLE CHANGES
  ]);

  /* ----------------------------------------
   * Selectors
   * --------------------------------------*/

  const selectedChartQuery = (selectedWidget as any)?.chartQuery;
  const selectedTableName = selectedChartQuery?.tableName;
  const selectedJoinsKey = JSON.stringify(selectedChartQuery?.joins || []);

  const selectedTableColumns = useMemo(() => {
    const tables = selectedSchemaInfo?.tables || [];
    if (!tables.length) return [];

    const joins = JSON.parse(selectedJoinsKey);
    const bareTableName = (table?: string) => table?.split('.').pop()?.trim() || table?.trim();
    const findSchemaTable = (tableName?: string) => {
      const bare = bareTableName(tableName);
      return tables.find((t: any) => bareTableName(t.name) === bare);
    };

    // Find the specific table if selected, else default to 'data' or the first usable one
    const table =
      (selectedTableName ? findSchemaTable(selectedTableName) : null) ||
      tables.find((t: any) => t.name === 'data') ||
      tables.find((t: any) => t.columns && t.columns.length > 0) ||
      tables[0];

    const baseColumns =
      table?.columns?.map((c: any) => ({
        label: c.name || c,
        value: c.name || c,
        type: c.type || 'string',
      })) ?? [];

    const relatedColumns = Array.isArray(joins)
      ? joins.flatMap((join: any) => {
          const joinTable = findSchemaTable(join?.table);
          const alias = join?.alias || bareTableName(join?.table);
          if (!joinTable?.columns || !alias) return [];
          return joinTable.columns.map((c: any) => {
            const columnName = c.name || c;
            const qualifiedName = `${alias}.${columnName}`;
            return {
              label: qualifiedName,
              value: qualifiedName,
              type: c.type || 'string',
            };
          });
        })
      : [];

    return [...baseColumns, ...relatedColumns];
  }, [
    selectedSchemaInfo,
    selectedTableName,
    selectedJoinsKey,
  ]);

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

    if (key === 'tableName') {
      nextQuery = ensureChartQueryDefaults(sanitizeQueryForTable(nextQuery, value));
    }

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

  const metricAggregationForField = (field: DashboardFieldDragPayload) => {
    const type = (field.columnType || '').toLowerCase();
    const isNumeric =
      type.includes('int') ||
      type.includes('float') ||
      type.includes('number') ||
      type.includes('decimal') ||
      type.includes('double') ||
      type.includes('real') ||
      type.includes('numeric');
    return isNumeric ? 'sum' : 'count';
  };

  const appendMetric = (metrics: any[] = [], field: DashboardFieldDragPayload, replace = false) => {
    const nextMetric = {
      field: field.columnName,
      aggregation: selectedWidget?.chartType === 'scatter' ? 'none' : metricAggregationForField(field),
    };
    if (replace) return [nextMetric];
    if (metrics.some((metric) => metric.field === field.columnName)) return metrics;
    return [...metrics, nextMetric];
  };

  const applyDroppedField = (targetKey: string, field: DashboardFieldDragPayload) => {
    const currentQuery = selectedWidget?.chartQuery || {};
    let nextQuery = ensureChartQueryDefaults({
      ...currentQuery,
      ...(field.tableName ? { tableName: field.tableName } : {}),
    });

    if (targetKey === 'yMetrics' || targetKey === 'yMetricsSecondary') {
      nextQuery = {
        ...nextQuery,
        [targetKey]: appendMetric(nextQuery[targetKey] || [], field),
      };
    } else if (targetKey === 'xMetrics') {
      nextQuery = {
        ...nextQuery,
        xMetrics: appendMetric(nextQuery.xMetrics || [], field, true),
      };
    } else if (targetKey === 'filters') {
      nextQuery = {
        ...nextQuery,
        filters: [
          ...(nextQuery.filters || []),
          {
            field: field.columnName,
            operator: '=',
            value: '',
            type: 'simple',
          },
        ],
      };
    } else if (targetKey === 'slicerField') {
      const existingFields = Array.isArray(nextQuery.fields) ? nextQuery.fields.map(String).filter(Boolean) : [];
      const fields = existingFields.includes(field.columnName)
        ? existingFields
        : [...existingFields, field.columnName];
      nextQuery = {
        ...nextQuery,
        field: field.columnName,
        fields,
        x: field.columnName,
        dataSourceId: field.dataSourceId,
      };
    } else {
      nextQuery = {
        ...nextQuery,
        [targetKey]: field.columnName,
      };

      const hasNoMetrics = !nextQuery.yMetrics || nextQuery.yMetrics.length === 0;
      if (targetKey === 'x' && hasNoMetrics && selectedWidget?.chartType !== 'scatter') {
        nextQuery = {
          ...nextQuery,
          yMetrics: [{ field: field.columnName, aggregation: 'count' }],
        };
      }
    }

    updateLocalAndStore({
      dataSourceId: field.dataSourceId || selectedWidget?.dataSourceId,
      chartQuery: nextQuery,
    });
  };

  // Atomic apply — updates title, chartType, x, y, and chartOptions in one store write
  // so the auto-sync effect sees a consistent state (no stale-closure overwrites).
  const applyWidgetChanges = (changes: {
    title: string;
    chartType: string;
    x: string | undefined;
    y: string | undefined;
    yAggregation?: string;
    chartOptions: Record<string, unknown>;
  }) => {
    const currentQuery = selectedWidget?.chartQuery || {};
    // Translate the simple y picker into yMetrics so the backend v2 chart_service
    // can consume it — it reads yMetrics[] not the plain y field for standard charts.
    const existingAgg = currentQuery.yMetrics?.[0]?.aggregation || 'count';
    const agg = changes.yAggregation || existingAgg;
    const nextYMetrics = changes.y
      ? [{ field: changes.y, aggregation: agg }]
      : currentQuery.yMetrics;
    const nextQuery = ensureChartQueryDefaults({
      ...currentQuery,
      x: changes.x,
      y: changes.y,
      yMetrics: nextYMetrics,
    });
    updateLocalAndStore({
      title: changes.title,
      chartType: changes.chartType,
      chartQuery: nextQuery,
      chartOptions: changes.chartOptions,
    });
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

  // Atomic apply for slicer widgets — single store write to avoid stale-closure issue
  // where sequential updateChartQuery calls each read the pre-render state.
  const applySlicerChanges = (changes: {
    title: string;
    field: string | undefined;
    fields?: string[];
    mode: string;
  }) => {
    const currentQuery = selectedWidget?.chartQuery || {};
    const fields = (changes.fields || []).filter(Boolean);
    const nextQuery = {
      ...currentQuery,
      field: changes.field,
      fields,
      x: changes.field,
      mode: changes.mode,
      // Mirror dataSourceId into chartQuery so SlicerWidget can load filter options
      dataSourceId: selectedWidget?.dataSourceId,
    };
    updateLocalAndStore({
      title: changes.title,
      chartQuery: nextQuery,
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
    applyDroppedField,
    applyWidgetChanges,
    applySlicerChanges,
    handleDataSourceChange,
    handleRefreshData,
    handleDeleteChart,
  };
};
