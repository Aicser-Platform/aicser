'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useChartDesignerStore } from '../../chart-designer/stores/useChartDesignerStore';
import type { DashboardFieldDragPayload } from '../utils/dashboardFieldDrag';
import {
  columnsFromQueryResult,
  inferChartMapping,
  wrapSqlAsSubquery,
} from '../utils/queryBindBridge';
import { preserveChartQueryOnTypeChange, normalizeChartOptionsOnTypeChange } from '../utils/chartTypeMappingPreserve';
import { enhancedDataService } from '@/services/enhancedDataService';
import { stripPinFreezeOptions } from '@/components/charts/chartDesignerBridge';

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
  const [savedQueryColumns, setSavedQueryColumns] = useState<Array<{ name: string; type?: string }>>([]);
  const [savedQueryColumnsLoading, setSavedQueryColumnsLoading] = useState(false);

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

  const ensureChartQueryDefaults = (query: any = {}) => {
    const next = {
      ...query,
      yMetric: query.yMetric ?? 'count',
      yMetrics: query.yMetrics ?? [],
      sortBy: query.sortBy ?? 'x',
    };
    // Chat pins sometimes store a column name in yMetric; promote to yMetrics.
    const yMetricVal = next.yMetric;
    const isAgg =
      typeof yMetricVal === 'string' &&
      ['count', 'sum', 'none', 'distinct_count', 'avg', 'min', 'max', 'mean'].includes(
        String(yMetricVal).toLowerCase(),
      );
    if (
      (!Array.isArray(next.yMetrics) || next.yMetrics.length === 0) &&
      typeof yMetricVal === 'string' &&
      yMetricVal &&
      !isAgg
    ) {
      next.yMetrics = [{ field: yMetricVal, aggregation: 'none' }];
      next.yMetric = 'none';
    }
    // Repair older multi-series pins: legend/data has N series but yMetrics only 1.
    const plotted = selectedWidget?.chartData?.series;
    if (
      Array.isArray(plotted) &&
      plotted.length > 1 &&
      (!Array.isArray(next.yMetrics) || next.yMetrics.length < plotted.length) &&
      !next.groupField &&
      !next.legend
    ) {
      const names = plotted
        .map((s: { name?: string }) => String(s?.name || '').trim())
        .filter((n: string) => n && !/^series\s*\d*$/i.test(n));
      if (names.length > 1) {
        next.yMetrics = names.map((field: string) => ({ field, aggregation: 'none' }));
        next.yMetric = 'none';
      }
    }
    // Hydrate XOR: multi-Y clears legend break-by (same as Build panel edits)
    if (Array.isArray(next.yMetrics) && next.yMetrics.length > 1 && (next.groupField || next.legend)) {
      delete next.groupField;
      delete next.legend;
      delete next.group;
    }
    return next;
  };

  const fieldName = (field?: unknown) => String(field || '').split('.').pop() || '';
  const isNumericType = (type?: unknown) => /(int|float|double|decimal|numeric|number|real)/i.test(String(type || ''));
  const isDimensionLikeField = (name?: unknown) => {
    const normalized = String(name || '').toLowerCase();
    return (
      !normalized ||
      normalized === 'id' ||
      normalized.endsWith('_id') ||
      normalized.endsWith('_key') ||
      normalized.includes('date') ||
      normalized.includes('month') ||
      normalized.includes('year') ||
      normalized.includes('quarter')
    );
  };
  const isMeasureColumn = (column: { name: string; type: string }) =>
    isNumericType(column.type) && !isDimensionLikeField(column.name);
  const isSqlBoundWidget = Boolean(
    selectedWidget?.chartQuery?.saved_query_id ||
      selectedWidget?.chartQuery?.query_snapshot_id ||
      selectedWidget?.chartOptions?.sample_sql,
  );
  const metricAggregationForColumn = (column?: { name: string; type: string }) => {
    // Custom SQL / saved query cards are pre-aggregated — Don't summarize (Metabase style).
    if (isSqlBoundWidget) return 'none';
    return column && isMeasureColumn(column) ? 'sum' : 'count';
  };
  const pickDefaultMetricColumn = (
    columns: Array<{ name: string; type: string }>,
    excludeField?: unknown,
  ) => {
    const excluded = fieldName(excludeField).toLowerCase();
    const candidates = columns.filter((column) => column.name.toLowerCase() !== excluded);
    return (
      candidates.find(isMeasureColumn) ||
      candidates.find((column) => isNumericType(column.type) && !isDimensionLikeField(column.name)) ||
      candidates.find((column) => !isDimensionLikeField(column.name)) ||
      candidates[0]
    );
  };

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
      columns.find((column: { name: string; type: string }) => !isNumericType(column.type))?.name ||
      columns.find((column: { name: string; type: string }) => isDimensionLikeField(column.name))?.name ||
      columns[0]?.name;
    const defaultMetric = pickDefaultMetricColumn(columns, query.x || firstDimension);
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
      next.yMetrics = defaultMetric
        ? [{ field: defaultMetric.name, aggregation: metricAggregationForColumn(defaultMetric) }]
        : [];
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
    const hasSqlSource = Boolean(
      selectedWidget?.chartQuery?.saved_query_id ||
        selectedWidget?.chartQuery?.query_snapshot_id ||
        (typeof selectedWidget?.chartOptions?.sample_sql === 'string' &&
          selectedWidget.chartOptions.sample_sql.trim()),
    );

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
        (!isMetricOnlyWidget || hasTable || hasSqlSource));

    if (!selectedWidgetId || !canSync || hasValidData || hasFailedCurrentQuery) {
      return;
    }

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      const syncChart = async () => {
        try {
          // Drop pin freeze on any live query sync so canvas follows Build edits
          const liveOptions = {
            ...stripPinFreezeOptions(selectedWidget.chartOptions || {}),
            __prefetchedChartData: undefined,
            __echartsSnapshot: undefined,
          };
          if (!selectedWidget.chartId) {
            if (createChartAndFetchData) {
              await createChartAndFetchData({
                ...selectedWidget,
                chartOptions: liveOptions,
                lastFetchedQueryHash: currentQueryHash,
              });
            } else if (isDesigner) {
              await updateChartAndFetchData(selectedWidgetId, {
                ...selectedWidget,
                chartOptions: liveOptions,
                lastFetchedQueryHash: currentQueryHash,
              });
            }
          } else {
            await updateChartAndFetchData(selectedWidgetId, {
              dataSourceId: selectedWidget.dataSourceId,
              title: selectedWidget.title,
              chartQuery: selectedWidget.chartQuery,
              chartOptions: liveOptions,
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
    selectedWidget?.chartQuery?.groupField,
    selectedWidget?.chartQuery?.saved_query_id,
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
    // SQL / saved-query mode: columns come from the SQL result shape, not base tables.
    const sqlMode =
      Boolean(selectedChartQuery?.saved_query_id) ||
      Boolean(selectedChartQuery?.query_snapshot_id) ||
      (typeof selectedWidget?.chartOptions?.sample_sql === 'string' &&
        selectedWidget.chartOptions.sample_sql.trim());
    if (sqlMode && savedQueryColumns.length > 0) {
      return savedQueryColumns.map((c) => ({
        label: c.name,
        value: c.name,
        type: c.type || 'unknown',
      }));
    }
    // While probing SQL columns, don't fall back to unrelated table schema.
    if (sqlMode) return [];

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
    selectedChartQuery?.saved_query_id,
    selectedChartQuery?.query_snapshot_id,
    selectedWidget?.chartOptions?.sample_sql,
    savedQueryColumns,
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

    // Switching chart type: preserve compatible mappings; trim by destination maxCount / XOR.
    if (key === 'chartType' && selectedWidget) {
      const nextQuery = preserveChartQueryOnTypeChange(selectedWidget, String(value));
      const nextOptions = normalizeChartOptionsOnTypeChange(
        String(value),
        (selectedWidget.chartOptions || {}) as Record<string, unknown>,
      );
      updateLocalAndStore({
        chartType: value,
        chartQuery: ensureChartQueryDefaults(nextQuery),
        chartOptions: nextOptions,
      });
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
      ...(key === 'pivotSwap' ? {} : { [key]: value }),
    });

    // Atomic Rows ↔ Columns swap (Tableau/Power BI pivot)
    if (key === 'pivotSwap' && value && typeof value === 'object') {
      const x = (value as { x?: string }).x;
      const groupField = (value as { groupField?: string }).groupField;
      nextQuery = ensureChartQueryDefaults({
        ...(selectedWidget.chartQuery || {}),
        x,
        groupField: groupField || undefined,
        legend: groupField || undefined,
      });
      if (!groupField) {
        delete nextQuery.groupField;
        delete nextQuery.legend;
      }
    }

    if (key === 'tableName') {
      nextQuery = ensureChartQueryDefaults(sanitizeQueryForTable(nextQuery, value));
    }

    // Clear date grain when X axis is cleared; soft-suggest grain for date-like X
    if (key === 'x') {
      if (!value) {
        nextQuery = { ...nextQuery, xGrain: undefined };
      } else if (
        !nextQuery.xGrain &&
        /date|time|year|month|week|day|quarter|hour|timestamp/i.test(String(value))
      ) {
        const name = String(value);
        nextQuery = {
          ...nextQuery,
          xGrain: /year/i.test(name)
            ? 'year'
            : /quarter/i.test(name)
              ? 'quarter'
              : /month/i.test(name)
                ? 'month'
                : /week/i.test(name)
                  ? 'week'
                  : /hour/i.test(name)
                    ? 'hour'
                    : 'day',
        };
      }
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
      const defaultMetric = pickDefaultMetricColumn(tableColumnsFor(nextQuery.tableName), value);
      nextQuery = {
        ...nextQuery,
        yMetrics: defaultMetric
          ? [{ field: defaultMetric.name, aggregation: metricAggregationForColumn(defaultMetric) }]
          : [{ field: value, aggregation: 'count' }],
      };
    }

    // Alias legend ↔ groupField so Build "Legend" drives backend groupField pivot.
    if (key === 'legend') {
      nextQuery = { ...nextQuery, groupField: value || undefined };
    }
    if (key === 'groupField') {
      nextQuery = { ...nextQuery, legend: value || undefined, groupField: value || undefined };
    }

    // Legend break-by and multi-measure are mutually exclusive (Power BI / Tableau style).
    // Pivot uses the first measure only; clear extras so the chart matches the config.
    if ((key === 'groupField' || key === 'legend') && value) {
      if (Array.isArray(nextQuery.yMetrics) && nextQuery.yMetrics.length > 1) {
        nextQuery = { ...nextQuery, yMetrics: nextQuery.yMetrics.slice(0, 1) };
      }
      if (Array.isArray(nextQuery.yMetricsSecondary) && nextQuery.yMetricsSecondary.length > 0) {
        nextQuery = { ...nextQuery, yMetricsSecondary: [] };
      }
    }
    if (
      (key === 'yMetrics' && Array.isArray(value) && value.length > 1) ||
      (key === 'yMetricsSecondary' && Array.isArray(value) && value.length > 0)
    ) {
      if (nextQuery.groupField || nextQuery.legend) {
        nextQuery = { ...nextQuery, groupField: undefined, legend: undefined };
      }
    }

    const patch: Record<string, unknown> = { chartQuery: nextQuery };

    // Auto-enable combo bars when secondary metrics are added (dual-axis UX).
    if (
      key === 'yMetricsSecondary' &&
      Array.isArray(value) &&
      value.length > 0 &&
      selectedWidget?.chartType === 'bar' &&
      selectedWidget?.chartOptions?.barChartType !== 'combo-line'
    ) {
      patch.chartOptions = {
        ...(selectedWidget.chartOptions || {}),
        barChartType: 'combo-line',
        showLegend: true,
      };
    }

    // Multi-metric / legend break → show legend so series are distinguishable.
    if (
      (key === 'yMetrics' && Array.isArray(value) && value.length > 1) ||
      (key === 'groupField' && value) ||
      (key === 'legend' && value)
    ) {
      patch.chartOptions = {
        ...((patch.chartOptions as Record<string, unknown>) || selectedWidget?.chartOptions || {}),
        showLegend: true,
      };
    }

    updateLocalAndStore(patch);
  };

  const metricAggregationForField = (field: DashboardFieldDragPayload) => {
    // Match click-path defaults: SQL/saved-query results are already projected.
    if (isSqlBoundWidget || selectedWidget?.chartType === 'scatter') return 'none';
    const type = (field.columnType || '').toLowerCase();
    const isNumeric = isNumericType(type);
    return isNumeric && !isDimensionLikeField(field.columnName) ? 'sum' : 'count';
  };

  const appendMetric = (metrics: any[] = [], field: DashboardFieldDragPayload, replace = false) => {
    const nextMetric = {
      field: field.columnName,
      aggregation: metricAggregationForField(field),
    };
    if (replace) return [nextMetric];
    if (metrics.some((metric) => metric.field === field.columnName)) return metrics;
    return [...metrics, nextMetric];
  };

  const applyDroppedField = (targetKey: string, field: DashboardFieldDragPayload) => {
    const currentQuery = selectedWidget?.chartQuery || {};
    // Never stamp a physical table onto a SQL-bound widget from a field drag.
    let nextQuery = ensureChartQueryDefaults({
      ...currentQuery,
      ...(!isSqlBoundWidget && field.tableName ? { tableName: field.tableName } : {}),
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
        const defaultMetric = pickDefaultMetricColumn(tableColumnsFor(nextQuery.tableName), field.columnName);
        nextQuery = {
          ...nextQuery,
          yMetrics: defaultMetric
            ? [{ field: defaultMetric.name, aggregation: metricAggregationForColumn(defaultMetric) }]
            : [{ field: field.columnName, aggregation: 'count' }],
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

  /**
   * Force persist + refetch now (Apply Changes).
   * Clears pin freeze + error/hash so chat/QE/designer widgets can rebind live.
   */
  const forceSyncChart = async (opts?: { title?: string }) => {
    if (!selectedWidgetId || !selectedWidget) return;

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    const title = opts?.title ?? selectedWidget.title;
    let chartQuery = ensureChartQueryDefaults(selectedWidget.chartQuery || {});
    const enteringTableMode = Boolean(
      chartQuery.tableName &&
        !chartQuery.saved_query_id &&
        !chartQuery.query_snapshot_id,
    );
    let chartOptions = stripPinFreezeOptions(selectedWidget.chartOptions || {}, {
      clearSql: enteringTableMode,
    });

    // Trim metrics when switching to single-metric chart types.
    const maxMetrics =
      selectedWidget.chartType === 'stat' || selectedWidget.chartType === 'gauge' ? 1 : undefined;
    if (maxMetrics && Array.isArray(chartQuery.yMetrics) && chartQuery.yMetrics.length > maxMetrics) {
      chartQuery = { ...chartQuery, yMetrics: chartQuery.yMetrics.slice(0, maxMetrics) };
    }

    // Keep legend/groupField aliases aligned before persist.
    if (chartQuery.legend && !chartQuery.groupField) {
      chartQuery = { ...chartQuery, groupField: chartQuery.legend };
    }
    if (chartQuery.groupField && !chartQuery.legend) {
      chartQuery = { ...chartQuery, legend: chartQuery.groupField };
    }

    if (
      selectedWidget.chartType === 'bar' &&
      (chartQuery.yMetricsSecondary?.length ?? 0) > 0 &&
      chartOptions.barChartType !== 'combo-line'
    ) {
      chartOptions = { ...chartOptions, barChartType: 'combo-line', showLegend: true };
    }

    const queryHash = stableStringify({ chartQuery });

    // Explicit nulls so store merge deletes freeze keys
    const chartOptionsPatch = {
      ...chartOptions,
      __prefetchedChartData: undefined,
      __echartsSnapshot: undefined,
      ...(enteringTableMode ? { sample_sql: undefined } : {}),
    };

    updateLocalAndStore({
      title,
      chartQuery,
      chartOptions: chartOptionsPatch,
      error: null,
      lastFetchedQueryHash: undefined,
    });

    try {
      if (!selectedWidget.chartId) {
        if (createChartAndFetchData) {
          await createChartAndFetchData({
            ...selectedWidget,
            title,
            chartQuery,
            chartOptions,
            lastFetchedQueryHash: queryHash,
            error: null,
          });
        }
      } else {
        await updateChartAndFetchData(selectedWidgetId, {
          dataSourceId: selectedWidget.dataSourceId,
          title,
          chartQuery,
          chartOptions: chartOptionsPatch,
          lastFetchedQueryHash: queryHash,
        });
      }
    } catch (err) {
      console.error('Force chart sync failed:', err);
      throw err;
    }
  };

  const handleDataSourceChange = (dataSourceId: string) => {
    // Full reset — exit SQL/pin freeze so table mode can rebuild on the new source
    setSavedQueryColumns([]);
    updateLocalAndStore({
      dataSourceId,
      chartQuery: { yMetric: 'count', yMetrics: [], sortBy: 'x' },
      chartOptions: {
        ...stripPinFreezeOptions(selectedWidget?.chartOptions || {}, { clearSql: true }),
        __prefetchedChartData: undefined,
        __echartsSnapshot: undefined,
        sample_sql: undefined,
      },
      chartData: null,
      error: null,
      lastFetchedQueryHash: undefined,
    });
    useDataSourceStore.getState().select(dataSourceId);
  };

  /**
   * Bind (or clear) a Query Editor saved SQL query as this widget's data shape.
   * Discovers result columns so Build field pickers match the query output.
   */
  const bindSavedQuery = useCallback(
    async (
      queryId: string | number | undefined,
      snapshot?: { id?: string | number; name?: string; sql?: string; metadata?: Record<string, unknown> },
    ) => {
      if (!selectedWidgetId || !selectedWidget) return;

      if (queryId == null || queryId === '') {
        setSavedQueryColumns([]);
        updateLocalAndStore({
          chartQuery: ensureChartQueryDefaults({
            ...(selectedWidget.chartQuery || {}),
            saved_query_id: undefined,
            query_snapshot_id: undefined,
          }),
          chartOptions: {
            ...(selectedWidget.chartOptions || {}),
            sample_sql: undefined,
            __prefetchedChartData: undefined,
            __echartsSnapshot: undefined,
          },
        });
        return;
      }

      const meta = (snapshot?.metadata || {}) as Record<string, unknown>;
      const metaDs = meta.data_source_id || meta.dataSourceId;
      const nextDsId = metaDs ? String(metaDs) : selectedWidget.dataSourceId;
      const sql = typeof snapshot?.sql === 'string' ? snapshot.sql : undefined;

      let columns: Array<{ name: string; type?: string }> = [];
      if (sql && nextDsId) {
        setSavedQueryColumnsLoading(true);
        try {
          const result = await enhancedDataService.executeMultiEngineQuery(
            wrapSqlAsSubquery(sql),
            String(nextDsId),
          );
          columns = columnsFromQueryResult(result as any);
        } catch (err) {
          console.warn('Could not discover saved-query columns:', err);
        } finally {
          setSavedQueryColumnsLoading(false);
        }
      }

      setSavedQueryColumns(columns);

      const inferred = inferChartMapping(columns, selectedWidget.chartType || 'bar', {
        preferNoneAggregation: true,
      });
      // Saved SQL is usually pre-aggregated — map all numeric measures with aggregation none
      // (same as Query Editor Visualize), not just the first measure with sum.
      const prev = selectedWidget.chartQuery || {};
      const preserved =
        Array.isArray(prev.yMetrics) && prev.yMetrics.length && columns.length
          ? prev.yMetrics.filter((m: { field?: string }) =>
              columns.some((c) => c.name === m.field),
            )
          : [];
      const yMetrics =
        preserved.length > 0
          ? preserved.map((m: { field: string; aggregation?: string }) => ({
              field: m.field,
              aggregation:
                !m.aggregation || m.aggregation === 'sum' ? 'none' : m.aggregation,
            }))
          : (inferred.yMetrics || []).map((m) => ({
              field: m.field,
              aggregation: 'none',
            }));

      // Legend break-by only when single measure (XOR with multi-Y)
      const groupField =
        yMetrics.length <= 1
          ? prev.groupField && columns.some((c) => c.name === prev.groupField)
            ? prev.groupField
            : inferred.groupField
          : undefined;

      const nextQuery = ensureChartQueryDefaults({
        ...prev,
        saved_query_id: String(queryId),
        tableName: undefined,
        joins: [],
        x:
          prev.x && columns.some((c) => c.name === prev.x)
            ? prev.x
            : inferred.x || columns[0]?.name,
        yMetrics,
        yMetric: 'none',
        groupField: groupField || undefined,
        legend: groupField || undefined,
      });
      if (!groupField) {
        delete nextQuery.groupField;
        delete nextQuery.legend;
      }
      delete nextQuery.tableName;

      updateLocalAndStore({
        ...(nextDsId ? { dataSourceId: nextDsId } : {}),
        chartQuery: nextQuery,
        chartOptions: {
          ...(selectedWidget.chartOptions || {}),
          // Prefer durable saved query over frozen sample_sql
          sample_sql: undefined,
        },
        title:
          selectedWidget.title && !/^(bar|line|area|pie|chart)/i.test(selectedWidget.title)
            ? selectedWidget.title
            : snapshot?.name || selectedWidget.title,
      });
    },
    [selectedWidget, selectedWidgetId, updateWidget],
  );

  const rediscoverSqlColumns = useCallback(async () => {
    if (!selectedWidget?.dataSourceId) return;
    const sqid = selectedWidget?.chartQuery?.saved_query_id;
    const sample =
      typeof selectedWidget?.chartOptions?.sample_sql === 'string'
        ? selectedWidget.chartOptions.sample_sql.trim()
        : '';
    if (!sqid && !sample) {
      setSavedQueryColumns([]);
      return;
    }
    setSavedQueryColumnsLoading(true);
    try {
      let sql = sample;
      if (sqid) {
        const { fetchApi } = await import('@/utils/api');
        const res = await fetchApi('queries/saved-queries');
        const list = (res as { items?: Array<{ id?: string | number; sql?: string }> })?.items || [];
        const found = list.find((q) => String(q.id) === String(sqid));
        if (found?.sql) sql = found.sql;
      }
      if (!sql?.trim()) {
        setSavedQueryColumns([]);
        return;
      }
      const result = await enhancedDataService.executeMultiEngineQuery(
        wrapSqlAsSubquery(sql),
        String(selectedWidget.dataSourceId),
      );
      setSavedQueryColumns(columnsFromQueryResult(result as any));
    } catch {
      /* keep prior columns if probe fails */
    } finally {
      setSavedQueryColumnsLoading(false);
    }
  }, [
    selectedWidget?.chartQuery?.saved_query_id,
    selectedWidget?.chartOptions?.sample_sql,
    selectedWidget?.dataSourceId,
  ]);

  // Discover SQL result columns for saved_query_id and/or sample_sql (reload + pin).
  useEffect(() => {
    if (!isSqlBoundWidget || !selectedWidget?.dataSourceId) {
      if (!isSqlBoundWidget) setSavedQueryColumns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await rediscoverSqlColumns();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isSqlBoundWidget,
    selectedWidget?.chartQuery?.saved_query_id,
    selectedWidget?.chartOptions?.sample_sql,
    selectedWidget?.dataSourceId,
    selectedWidgetId,
    rediscoverSqlColumns,
  ]);

  // Returning from Query Editor: refresh bound SQL columns on window focus.
  useEffect(() => {
    if (!isSqlBoundWidget) return;
    const onFocus = () => {
      void rediscoverSqlColumns();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void rediscoverSqlColumns();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isSqlBoundWidget, rediscoverSqlColumns]);

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
    forceSyncChart,
    bindSavedQuery,
    savedQueryColumnsLoading,
    rediscoverSqlColumns,
    handleDataSourceChange,
    handleRefreshData,
    handleDeleteChart,
    isSqlBoundWidget,
  };
};
