'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Select, Space, Tag, Typography, message } from 'antd';
import { BarChartOutlined, CloseOutlined, CopyOutlined, PlusOutlined, PushpinOutlined, ReloadOutlined, SlidersOutlined, TableOutlined } from '@ant-design/icons';
import type { Model } from '@ironcalc/workbook';
import { useTranslations } from 'next-intl';
import type { DataRange } from '@/services/workbookService';
import { pivot } from '@/app/(dashboard)/notebooks/components/chartShape';
import { shapeChart } from '@/app/(dashboard)/notebooks/components/chartShape';
import { suggestChart, suggestPivot } from '@/app/(dashboard)/notebooks/components/chartDefaults';
import { PivotView, pivotGrid } from '@/app/(dashboard)/notebooks/components/PivotView';
import { PivotFieldsPanel, emptyPivotLayout } from '@/components/analytics/PivotFieldsPanel';
import { ChartFieldsPanel } from '@/components/analytics/ChartFieldsPanel';
import { layoutToPivotSpec } from '@/components/analytics/pivotFieldLayout';
import {
  emptyChartLayout,
  type ChartFieldLayout,
  type PivotFieldLayout,
} from '@/components/analytics/pivotFieldLayout';
import { SharedChartRenderer } from '@/components/charts/SharedChartRenderer';
import { AddChartToDashboardModal } from '@/components/charts/AddChartToDashboardModal';
import { useAddChartToDashboard } from '@/hooks/useAddChartToDashboard';
import { buildChatMessagePinSource } from '@/components/charts/buildChatChartPinPayload';
import { useOpenChartDesignerFromChat } from '@/hooks/useOpenChartDesignerFromChat';
import { writeTable } from './cellEncoding';
import { extractSheetTableDatasets, type SheetGridSelection } from './sheetTableExtract';
import {
  type SheetInsertPlacement,
  resolveSheetWriteAnchor,
  shapedChartToGrid,
} from './sheetInsertAnchor';

const { Text } = Typography;

export type AnalyzeTab = 'pivot' | 'chart';

/** Restores Analyze panel field layout when reopening a linked chart on the sheet. */
export type SheetAnalyzeRestore = {
  tab?: AnalyzeTab;
  datasetId?: string;
  pivotLayout?: PivotFieldLayout;
  chartLayout?: ChartFieldLayout;
  chartType?: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
};

export function SheetAnalyzePanel({
  tab,
  onTabChange,
  onClose,
  model,
  ranges,
  sheetName,
  gridSelection,
  readOnly,
  workbookId,
  workbookTitle,
  restore,
  restoreKey,
  onTableInserted,
  onRefreshRange,
  onInsertVisualChart,
  onPivotInserted,
}: {
  tab: AnalyzeTab;
  onTabChange: (t: AnalyzeTab) => void;
  onClose: () => void;
  model: Model | null;
  ranges: DataRange[];
  sheetName: (sheet: number) => string;
  gridSelection?: SheetGridSelection | null;
  readOnly?: boolean;
  workbookId: string;
  workbookTitle: string;
  restore?: SheetAnalyzeRestore | null;
  restoreKey?: string | null;
  onTableInserted?: (written: { sheet: number; row: number; column: number; width: number; height: number }) => void;
  /** Re-run a live data range query into the grid (then pivot/chart re-read cells). */
  onRefreshRange?: (range: DataRange) => Promise<void>;
  onInsertVisualChart?: (payload: {
    chartType: string;
    chartData: { x: string[]; series: { name: string; data: (number | null)[]; type?: string; areaStyle?: object }[] };
    title: string;
    placement: SheetInsertPlacement;
    analyzeBinding?: SheetAnalyzeRestore;
  }) => void;
  onPivotInserted?: (payload: {
    sheet: number;
    row: number;
    column: number;
    width: number;
    height: number;
    analyzeBinding: SheetAnalyzeRestore;
  }) => void;
}) {
  const t = useTranslations('sheets');
  const datasets = useMemo(
    () => extractSheetTableDatasets(model, ranges, sheetName, gridSelection),
    [model, ranges, sheetName, gridSelection],
  );

  const [datasetId, setDatasetId] = useState('selection');
  const [pickOtherTable, setPickOtherTable] = useState(false);
  const [pivotLayout, setPivotLayout] = useState(emptyPivotLayout);
  const [chartLayout, setChartLayout] = useState<ChartFieldLayout>(emptyChartLayout);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area' | 'pie' | 'scatter'>('bar');
  const [insertPlacement, setInsertPlacement] = useState<SheetInsertPlacement>('active_cell');
  const [refreshing, setRefreshing] = useState(false);
  const [boundColumnsKey, setBoundColumnsKey] = useState('');

  const active = useMemo(
    () => datasets.find((d) => d.id === datasetId) || datasets[0] || null,
    [datasets, datasetId],
  );

  const columnsKey = (cols: string[]) => cols.join('\0');

  const applyFieldSuggestions = useCallback((ds: NonNullable<typeof active>) => {
    const s = suggestPivot(ds.columns, ds.rows);
    setPivotLayout({
      ...emptyPivotLayout,
      rows: s.rows ?? [],
      columns: s.columns ?? [],
      values: s.values?.length ? s.values : [],
      agg: (s.agg && s.agg !== 'none' ? s.agg : 'sum') as typeof emptyPivotLayout.agg,
    });
    const chart = suggestChart(ds.columns, ds.rows);
    const chartTypeFromSuggest = chart.type === 'scatter' ? 'scatter' : chart.type === 'line' ? 'line' : 'bar';
    setChartType(chartTypeFromSuggest);
    setChartLayout({
      ...emptyChartLayout,
      category: chart.x ?? null,
      values: chart.y ?? [],
      agg: (chart.agg && chart.agg !== 'none' ? chart.agg : 'sum') as typeof emptyChartLayout.agg,
    });
    setBoundColumnsKey(columnsKey(ds.columns));
  }, []);

  useEffect(() => {
    const hasSelection = datasets.some((d) => d.id === 'selection');
    setDatasetId(hasSelection ? 'selection' : (datasets[0]?.id ?? ''));
    setPickOtherTable(false);
  }, [datasets, gridSelection?.label]);

  useEffect(() => {
    if (!restore || !restoreKey) return;
    if (restore.tab) onTabChange(restore.tab);
    if (restore.datasetId) setDatasetId(restore.datasetId);
    if (restore.pivotLayout) setPivotLayout(restore.pivotLayout);
    if (restore.chartLayout) setChartLayout(restore.chartLayout);
    if (restore.chartType) setChartType(restore.chartType);
    if (restore.datasetId || restore.pivotLayout || restore.chartLayout) {
      setPickOtherTable(Boolean(restore.datasetId && restore.datasetId !== 'selection'));
    }
  }, [restore, restoreKey, onTabChange]);

  useEffect(() => {
    if (!active) {
      setPivotLayout(emptyPivotLayout);
      setBoundColumnsKey('');
      return;
    }
    applyFieldSuggestions(active);
  }, [active?.id, applyFieldSuggestions]);

  const columnsDrifted = Boolean(
    active && boundColumnsKey && columnsKey(active.columns) !== boundColumnsKey,
  );

  const boundRange = useMemo(
    () => (active?.rangeId ? ranges.find((r) => r.id === active.rangeId) : undefined),
    [active?.rangeId, ranges],
  );

  const bindingDescription = useMemo(() => {
    if (!active) return null;
    if (active.sourceKind === 'selection') return t('analyze_binding_selection');
    if (active.sourceKind === 'range') return t('analyze_binding_range', { name: active.name });
    return t('analyze_binding_sheet');
  }, [active, t]);

  const handleRefreshBinding = async () => {
    if (!active?.live || !boundRange || !onRefreshRange) return;
    setRefreshing(true);
    try {
      await onRefreshRange(boundRange);
      message.success(t('refresh_all'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('analyze_refresh_failed'));
    } finally {
      setRefreshing(false);
    }
  };

  const pivotLabels = useMemo(() => ({
    fieldsTitle: t('pivot_fields_title'),
    fieldsHint: t('pivot_fields_dnd_hint'),
    zoneRows: t('pivot_rows'),
    zoneColumns: t('pivot_columns'),
    zoneValues: t('pivot_values'),
    zoneFilters: t('pivot_filters'),
    summarize: t('pivot_summarize'),
    addToRow: t('pivot_add_row'),
    addToColumn: t('pivot_add_column'),
    addToValues: t('pivot_add_values'),
    addToFilters: t('pivot_add_filters'),
    aggLabel: (agg: string) => t(`pivot_agg_${agg}`),
    filterAll: t('pivot_filter_all'),
    dragHint: t('pivot_drop_hint'),
  }), [t]);

  const chartLabels = useMemo(() => ({
    fieldsTitle: t('chart_fields_title'),
    fieldsHint: t('pivot_fields_dnd_hint'),
    zoneCategory: t('chart_x'),
    zoneSeries: t('chart_split_by'),
    zoneValues: t('chart_y'),
    summarize: t('pivot_summarize'),
    dragHint: t('pivot_drop_hint'),
    aggLabel: (agg: string) => t(`pivot_agg_${agg}`),
  }), [t]);

  const pivotSpec = useMemo(() => (active ? layoutToPivotSpec(pivotLayout) : null), [active, pivotLayout]);
  const pivotResult = useMemo(() => {
    if (!active || !pivotSpec || !pivotLayout.rows.length) return null;
    return pivot(active.columns, active.rows, pivotSpec);
  }, [active, pivotSpec, pivotLayout.rows.length]);

  const shaped = useMemo(() => {
    if (!active || !chartLayout.category) return null;
    const y = chartLayout.values.length ? chartLayout.values : [];
    const agg = y.length ? chartLayout.agg : 'count';
    return shapeChart(active.columns, active.rows, {
      x: chartLayout.category,
      y,
      agg,
      series: chartType === 'pie' ? null : chartLayout.series,
    });
  }, [active, chartLayout, chartType]);

  const chartRenderData = useMemo(() => {
    if (!shaped) return null;
    return {
      x: shaped.categories,
      y: shaped.series[0]?.data ?? [],
      series: shaped.series.map((s) => ({
        name: s.name,
        data: s.data,
        type: chartType === 'area' ? 'line' : chartType,
        areaStyle: chartType === 'area' ? {} : undefined,
      })),
    };
  }, [shaped, chartType]);

  const addToDashboard = useAddChartToDashboard();
  const { openInDesigner, opening: openingDesigner } = useOpenChartDesignerFromChat();

  const buildPinSource = () => {
    if (!chartRenderData || !chartLayout.category || !active) return null;
    const title = `${chartLayout.values.join(', ') || 'count'} by ${chartLayout.category}`;
    const rows = active.rows.map((row) => {
      const item: Record<string, unknown> = {};
      active.columns.forEach((col, i) => { item[col] = row[i]; });
      return item;
    });
    return buildChatMessagePinSource({
      id: `sheet-${workbookId}-${crypto.randomUUID()}`,
      echartsConfig: {
        title: { text: title },
        series: chartRenderData.series,
        xAxis: { type: 'category', data: chartRenderData.x },
        yAxis: { type: 'value' },
      },
      title: `${title} (${workbookTitle})`,
      queryResult: rows,
    });
  };

  const handleCopyPivot = () => {
    if (!pivotResult) return;
    const grid = pivotGrid(pivotResult, t('pivot_grand_total'));
    const tsv = [grid.columns.join('\t'), ...grid.rows.map((r) => r.join('\t'))].join('\n');
    void navigator.clipboard.writeText(tsv);
    message.success(t('pivot_copied'));
  };

  const insertPlacementOptions = useMemo(() => ([
    { value: 'active_cell' as const, label: t('insert_at_active_cell') },
    { value: 'below_selection' as const, label: t('insert_below_selection'), disabled: !gridSelection },
    { value: 'new_sheet' as const, label: t('insert_new_sheet') },
  ]), [t, gridSelection]);

  const writeAtPlacement = (
    columns: string[],
    rows: unknown[][],
    newSheetName: string,
  ) => {
    if (!model) return null;
    const { sheet, row, column } = resolveSheetWriteAnchor(model, insertPlacement, gridSelection, newSheetName);
    const written = writeTable(model, sheet, row, column, columns, rows);
    onTableInserted?.({ sheet, row, column, width: written.width, height: written.height });
    return written;
  };

  const handleInsertPivot = () => {
    if (!model || !pivotResult) return;
    try {
      const grid = pivotGrid(pivotResult, t('pivot_grand_total'));
      const { sheet, row, column } = resolveSheetWriteAnchor(
        model,
        insertPlacement,
        gridSelection,
        t('pivot_table'),
      );
      const written = writeTable(model, sheet, row, column, grid.columns, grid.rows);
      onTableInserted?.({
        sheet,
        row,
        column,
        width: written.width,
        height: written.height,
      });
      onPivotInserted?.({
        sheet,
        row,
        column,
        width: written.width,
        height: written.height,
        analyzeBinding: {
          tab: 'pivot',
          datasetId,
          pivotLayout,
        },
      });
      message.success(t('pivot_inserted'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('pivot_insert_failed'));
    }
  };

  const handleCopyChart = () => {
    if (!shaped || !chartLayout.category) return;
    const { columns, rows } = shapedChartToGrid(shaped, chartLayout.category);
    const tsv = [columns.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
    void navigator.clipboard.writeText(tsv);
    message.success(t('chart_copied'));
  };

  const handleInsertVisualChart = () => {
    if (!chartRenderData || !chartLayout.category || !onInsertVisualChart) return;
    const title = `${chartLayout.values.join(', ') || t('pivot_agg_count')} · ${chartLayout.category}`;
    onInsertVisualChart({
      chartType,
      chartData: chartRenderData,
      title,
      placement: insertPlacement,
      analyzeBinding: {
        tab: 'chart',
        datasetId,
        chartLayout,
        chartType,
      },
    });
    message.success(t('chart_inserted_visual'));
  };

  const handleInsertChart = () => {
    if (!model || !shaped || !chartLayout.category) return;
    try {
      const title = `${chartLayout.values.join(', ') || t('pivot_agg_count')} · ${chartLayout.category}`;
      const { columns, rows } = shapedChartToGrid(shaped, chartLayout.category);
      const { sheet, row, column } = resolveSheetWriteAnchor(model, insertPlacement, gridSelection, t('chart'));
      model.pauseEvaluation();
      try {
        model.setUserInput(sheet, row, column, `'${title}`);
        model.updateRangeStyle({ sheet, row, column, width: 1, height: 1 }, 'font.b', 'true');
      } finally {
        model.resumeEvaluation();
      }
      const written = writeTable(model, sheet, row + 2, column, columns, rows);
      onTableInserted?.({
        sheet,
        row,
        column,
        width: Math.max(written.width, 1),
        height: written.height + 2,
      });
      message.success(t('chart_inserted'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('chart_insert_failed'));
    }
  };

  const chartSpecForView = pivotSpec ? { ...pivotSpec, from: active?.name } : {};

  return (
    <aside className="wb-panel wb-panel--analyze" aria-label={t('analyze_panel_title')}>
      <div className="wb-panel__head">
        <Segmented
          size="small"
          value={tab}
          onChange={(v) => onTabChange(v as AnalyzeTab)}
          options={[
            { value: 'pivot', label: t('pivot_table'), icon: <TableOutlined /> },
            { value: 'chart', label: t('chart'), icon: <BarChartOutlined /> },
          ]}
        />
        <Button size="small" type="text" icon={<CloseOutlined />} aria-label={t('close')} onClick={onClose} />
      </div>

      {!datasets.length ? (
        <Text type="secondary">{t('pivot_no_data')}</Text>
      ) : (
        <>
          <div className="wb-analyze__binding">
            <Text strong style={{ fontSize: 13 }}>{t('analyze_binding_title')}</Text>
            {bindingDescription ? (
              <Space size={4} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>{bindingDescription}</Text>
                {active?.live ? <Tag color="blue">{t('analyze_binding_live')}</Tag> : null}
              </Space>
            ) : null}
            {active ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('analyze_binding_rows', { columns: active.columns.length, rows: active.rows.length })}
              </Text>
            ) : null}
            {columnsDrifted ? (
              <Alert
                type="warning"
                showIcon
                message={t('analyze_columns_changed')}
                action={(
                  <Button size="small" onClick={() => active && applyFieldSuggestions(active)}>
                    {t('analyze_reset_fields')}
                  </Button>
                )}
              />
            ) : null}
            <Space wrap size={4}>
              {active?.live && boundRange && onRefreshRange && !readOnly ? (
                <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleRefreshBinding()}>
                  {t('analyze_refresh_data')}
                </Button>
              ) : null}
              {datasets.some((d) => d.id === 'selection') && datasetId !== 'selection' ? (
                <Button
                  size="small"
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() => { setDatasetId('selection'); setPickOtherTable(false); }}
                >
                  {t('analyze_use_selection')}
                </Button>
              ) : null}
              {active ? (
                <Button size="small" type="link" style={{ padding: 0 }} onClick={() => applyFieldSuggestions(active)}>
                  {t('analyze_reset_fields')}
                </Button>
              ) : null}
            </Space>
          </div>

          <div className="wb-analyze__source">
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{t('pivot_step_table')}</Text>
            {gridSelection && active?.id === 'selection' && !pickOtherTable ? (
              <Space direction="vertical" size={4}>
                <Text style={{ fontSize: 13 }}>{t('pivot_using_selection', { area: gridSelection.label })}</Text>
                {datasets.length > 1 ? (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setPickOtherTable(true)}>
                    {t('pivot_pick_other_table')}
                  </Button>
                ) : null}
              </Space>
            ) : (
              <Select
                size="small"
                style={{ width: '100%' }}
                value={active?.id}
                onChange={setDatasetId}
                options={datasets.map((d) => ({
                  value: d.id,
                  label: d.id === 'selection'
                    ? t('pivot_dataset_selection', { area: d.name, rows: d.rows.length })
                    : `${d.name} (${d.rows.length.toLocaleString()} rows)`,
                }))}
              />
            )}
          </div>

          {tab === 'pivot' && active ? (
            <>
              <PivotFieldsPanel
                compact
                columns={active.columns}
                rows={active.rows}
                layout={pivotLayout}
                onChange={setPivotLayout}
                labels={pivotLabels}
                disabled={readOnly}
              />
              {pivotLayout.rows.length && pivotResult ? (
                <div className="wb-analyze__preview">
                  <PivotView spec={chartSpecForView} columns={active.columns} rows={active.rows} fileName={active.name} />
                </div>
              ) : (
                <Text type="secondary">{t('pivot_fields_empty')}</Text>
              )}
              <div className="wb-analyze__insert">
                <Text type="secondary" style={{ fontSize: 12 }}>{t('insert_placement_label')}</Text>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={insertPlacement}
                  onChange={setInsertPlacement}
                  options={insertPlacementOptions}
                  disabled={readOnly}
                />
              </div>
              <div className="wb-analyze__actions">
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopyPivot} disabled={!pivotResult}>{t('pivot_copy')}</Button>
                {!readOnly ? (
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleInsertPivot} disabled={!pivotResult}>
                    {t('pivot_insert')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === 'chart' && active ? (
            <>
              <Select
                size="small"
                style={{ width: '100%', marginBottom: 8 }}
                value={chartType}
                onChange={(v) => setChartType(v)}
                options={(['bar', 'line', 'area', 'pie', 'scatter'] as const).map((k) => ({ value: k, label: t(`chart_type_${k}`) }))}
              />
              <ChartFieldsPanel
                columns={active.columns}
                layout={chartLayout}
                onChange={setChartLayout}
                labels={chartLabels}
                disabled={readOnly}
                hideSeries={chartType === 'pie'}
              />
              {chartRenderData ? (
                <div className="wb-analyze__chart">
                  <SharedChartRenderer
                    chartType={chartType}
                    chartData={chartRenderData}
                    chartOptions={{ title: chartLayout.category ?? '' }}
                    minHeight={220}
                  />
                </div>
              ) : (
                <Text type="secondary">{t('chart_pick_fields')}</Text>
              )}
              <div className="wb-analyze__insert">
                <Text type="secondary" style={{ fontSize: 12 }}>{t('insert_placement_label')}</Text>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={insertPlacement}
                  onChange={setInsertPlacement}
                  options={insertPlacementOptions}
                  disabled={readOnly}
                />
              </div>
              <div className="wb-analyze__actions">
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopyChart} disabled={!chartRenderData}>
                  {t('chart_copy')}
                </Button>
                {!readOnly ? (
                  <>
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleInsertChart} disabled={!chartRenderData}>
                      {t('chart_insert_table')}
                    </Button>
                    {onInsertVisualChart ? (
                      <Button size="small" icon={<BarChartOutlined />} onClick={handleInsertVisualChart} disabled={!chartRenderData}>
                        {t('chart_insert_visual')}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button
                  size="small"
                  icon={<SlidersOutlined />}
                  loading={openingDesigner}
                  disabled={!chartRenderData}
                  onClick={() => {
                    const pinSource = buildPinSource();
                    if (pinSource) void openInDesigner({ source: pinSource, title: pinSource.title ?? workbookTitle });
                  }}
                >
                  {t('chart_designer')}
                </Button>
                <Button
                  size="small"
                  icon={<PushpinOutlined />}
                  disabled={!chartRenderData}
                  onClick={() => {
                    const pinSource = buildPinSource();
                    if (pinSource) void addToDashboard.openModal(pinSource, null);
                  }}
                >
                  {t('chart_pin')}
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}

      <AddChartToDashboardModal
        open={addToDashboard.open}
        dashboards={addToDashboard.modalDashboards}
        targetDashboardId={addToDashboard.targetDashboardId}
        onTargetChange={addToDashboard.setTargetDashboardId}
        creatingNew={addToDashboard.creatingNew}
        newDashboardName={addToDashboard.newDashboardName}
        onNewDashboardNameChange={addToDashboard.setNewDashboardName}
        onConfirm={() => void addToDashboard.confirmAdd()}
        onCancel={addToDashboard.closeModal}
        confirmLoading={addToDashboard.submitting}
        subtitle={t('chart_pin_from_sheet', { title: workbookTitle })}
      />
    </aside>
  );
}
