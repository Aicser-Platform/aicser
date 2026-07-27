'use client';

import React, { useState, useEffect } from 'react';
import { Tabs, Input, Select, Button, Tooltip, Collapse, Modal, Segmented } from 'antd';
import {
  MenuUnfoldOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useWidgetProperties } from '../hooks/useWidgetProperties';
import { ChartOptions } from './ChartOptions';
import { ChartSpecificFields } from './ChartSpecificFields';
import { SavedQueryPicker } from './SavedQueryPicker';
import { SavedQuerySqlEditor } from './SavedQuerySqlEditor';
import { AvailableFieldsPanel } from './AvailableFieldsPanel';
import { PpLabel } from './PpLabel';
import { PageFilterValueSelect } from './PageFilterValueSelect';
import { RelatedJoinsPicker } from './RelatedJoinsPicker';
import { useDashboardStore } from '../stores/useDashboardStore';
import type { DashboardFilter } from '@/types/dashboard';
import type { RuntimeFilter } from '../utils/filterOperators';
import { getDashboardFieldDragData, isDashboardFieldDrag } from '../utils/dashboardFieldDrag';
import { enhancedDataService } from '@/services/enhancedDataService';
import { useTranslations } from 'next-intl';
import { isContentWidgetType, isControlWidgetType } from './widgetPropertyProfile';
import { DASHBOARD_CHART_TYPE_SWITCHER } from './dashboardChartTypeSwitcher';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  removeWidget: (id: string) => void;
  isCollapsed: boolean;
  onCollapse?: () => void;
  isDesigner?: boolean;
  // Dashboard pages — passed through to ChartSpecificFields (analytics tab)
  dashboardPages?: { id: string; name: string }[];
  // Filters tab props
  globalFiltersConfig?: DashboardFilter[];
  pageFiltersConfig?: DashboardFilter[];
  runtimeFilters?: RuntimeFilter[];
  onRuntimeFiltersChange?: (filters: RuntimeFilter[]) => void;
  /** Opens Manage filters (page/global) from empty Filters state. */
  onOpenManageFilters?: () => void;
}

const CHART_TYPES = DASHBOARD_CHART_TYPE_SWITCHER;

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedWidget,
  selectedWidgetId,
  widgets,
  setWidgets,
  isCollapsed,
  onCollapse,
  removeWidget,
  isDesigner = false,
  dashboardPages = [],
  globalFiltersConfig = [],
  pageFiltersConfig = [],
  runtimeFilters = [],
  onRuntimeFiltersChange,
  onOpenManageFilters,
}) => {
  const {
    dataSources,
    selectedTableColumns,
    availableTables,
    handleDataSourceChange,
    isLoading,
    updateWidgetRoot,
    updateChartQuery,
    applyDroppedField,
    applySlicerChanges,
    forceSyncChart,
    bindSavedQuery,
    savedQueryColumnsLoading,
    schemaLoading,
    isSqlBoundWidget,
  } = useWidgetProperties({ selectedWidget, selectedWidgetId, widgets, setWidgets, isDesigner });

  const sqlBound = Boolean(
    isSqlBoundWidget ||
      selectedWidget?.chartQuery?.saved_query_id ||
      selectedWidget?.chartQuery?.query_snapshot_id ||
      (typeof selectedWidget?.chartOptions?.sample_sql === 'string' &&
        selectedWidget.chartOptions.sample_sql.trim()),
  );
  const [sqlEditorOpen, setSqlEditorOpen] = useState(false);
  const tDash = useTranslations('dashboards');
  const [applyLoading, setApplyLoading] = useState(false);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);

  const fetchFilterOptions = React.useCallback(
    async (
      field: string,
      dataSourceId: string,
      ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
    ) => {
      if (!activeDashboardId) return [];
      const { chartService } = await import('../services/chartService');
      return chartService.getFilterOptions(activeDashboardId, field, dataSourceId, {
        tableName: ctx?.tableName,
        runtimeFilters: ctx?.runtimeFilters,
        excludeField: ctx?.excludeField,
      });
    },
    [activeDashboardId],
  );

  const fetchVisualDistinctValues = React.useCallback(
    async (field: string) => {
      const dsId = selectedWidget?.dataSourceId;
      if (!dsId || !activeDashboardId) return [];
      try {
        const { normalizeFilterOptions, unwrapFilterOptionsResponse } = await import(
          '../utils/filterOperators'
        );

        // SQL-bound: distincts from the query result, not a physical table.
        if (sqlBound) {
          let sql =
            typeof selectedWidget?.chartOptions?.sample_sql === 'string'
              ? selectedWidget.chartOptions.sample_sql.trim()
              : '';
          const sqid = selectedWidget?.chartQuery?.saved_query_id;
          if (sqid) {
            const { fetchApi } = await import('@/utils/api');
            const res = await fetchApi('queries/saved-queries');
            const list =
              (res as { items?: Array<{ id?: string | number; sql?: string }> })?.items || [];
            const found = list.find((q) => String(q.id) === String(sqid));
            if (found?.sql) sql = found.sql;
          }
          if (sql) {
            const safeField = String(field).replace(/"/g, '""');
            const distinctSql = `SELECT DISTINCT "${safeField}" AS v FROM (${sql.replace(/;+\s*$/, '')}) AS _aicser_f WHERE "${safeField}" IS NOT NULL LIMIT 500`;
            const result = await enhancedDataService.executeMultiEngineQuery(
              distinctSql,
              String(dsId),
            );
            const rows = (result as { data?: Array<Record<string, unknown>> })?.data || [];
            const values = rows
              .map((r) => r.v ?? r.V ?? Object.values(r)[0])
              .filter((v) => v != null && String(v).trim() !== '')
              .map((v) => ({ label: String(v), value: String(v) }));
            if (values.length) return values;
          }
        }

        const { chartService } = await import('../services/chartService');
        const raw = await chartService.getFilterOptions(activeDashboardId, field, String(dsId), {
          tableName: selectedWidget?.chartQuery?.tableName,
        });
        return normalizeFilterOptions(unwrapFilterOptionsResponse(raw));
      } catch {
        return [];
      }
    },
    [
      activeDashboardId,
      selectedWidget?.dataSourceId,
      selectedWidget?.chartQuery?.tableName,
      selectedWidget?.chartQuery?.saved_query_id,
      selectedWidget?.chartOptions?.sample_sql,
      sqlBound,
    ],
  );

  const confirmDataSourceChange = (dataSourceId: string) => {
    if (!dataSourceId) {
      handleDataSourceChange(dataSourceId);
      return;
    }
    if (sqlBound && String(selectedWidget?.dataSourceId || '') !== String(dataSourceId)) {
      Modal.confirm({
        title: tDash('ds_change_sql_title'),
        content: tDash('ds_change_sql_body'),
        okText: tDash('ds_change_sql_ok'),
        okButtonProps: { danger: true },
        cancelText: tDash('switch_to_table_cancel'),
        onOk: () => handleDataSourceChange(dataSourceId),
      });
      return;
    }
    handleDataSourceChange(dataSourceId);
  };

  const dataSourceOptions = (dataSources || []).map((ds: any) => ({
    value: String(ds.id),
    label: ds.name || ds.id,
  }));

  const tableOptions = (availableTables || []).map((t: string) => ({
    value: t,
    label: t,
  }));

  // Local pending state — committed on Apply Changes
  const [pendingTitle, setPendingTitle] = useState<string>('');
  const [pendingChartType, setPendingChartType] = useState<string>('bar');
  // Slicer-specific pending state
  const [pendingSlicerField, setPendingSlicerField] = useState<string | undefined>(undefined);
  const [pendingSlicerFields, setPendingSlicerFields] = useState<string[]>([]);
  const [pendingSlicerMode, setPendingSlicerMode] = useState<string>('single');

  const isSlicer = isControlWidgetType(selectedWidget?.chartType);
  /** Narrative / media blocks — no data mapping (Notion / Looker content widgets). */
  const isContentBlock = isContentWidgetType(selectedWidget?.chartType);

  // Sync pending state when widget selection changes
  useEffect(() => {
    if (!selectedWidget) return;
    setPendingTitle(selectedWidget.title || '');
    setPendingChartType(selectedWidget.chartType || 'bar');
    // Slicer
    const slicerFields = Array.isArray((selectedWidget.chartQuery as any)?.fields)
      ? ((selectedWidget.chartQuery as any).fields as unknown[]).map(String).filter(Boolean)
      : [];
    const slicerField = (selectedWidget.chartQuery as any)?.field || selectedWidget.chartQuery?.x;
    setPendingSlicerField(slicerField);
    setPendingSlicerFields(slicerFields.length > 0 ? slicerFields : slicerField ? [String(slicerField)] : []);
    setPendingSlicerMode((selectedWidget.chartQuery as any)?.mode || 'single');
  }, [selectedWidgetId, selectedWidget]);

  const hasWidget = Boolean(selectedWidget && selectedWidgetId);

  // Auto-commit title so Apply is only needed to force refresh
  useEffect(() => {
    if (!hasWidget || isDesigner || isSlicer) return;
    const current = selectedWidget?.title || '';
    if (pendingTitle === current) return;
    const timer = window.setTimeout(() => {
      updateWidgetRoot('title', pendingTitle);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pendingTitle, hasWidget, isDesigner, isSlicer, selectedWidget?.title, updateWidgetRoot]);

  // Auto-commit slicer field/mode (title still via pendingTitle effect above when not slicer-only)
  useEffect(() => {
    if (!hasWidget || !isSlicer) return;
    const fields =
      pendingSlicerFields.length > 0
        ? pendingSlicerFields
        : pendingSlicerField
          ? [pendingSlicerField]
          : [];
    const curFields = Array.isArray((selectedWidget?.chartQuery as any)?.fields)
      ? ((selectedWidget.chartQuery as any).fields as string[]).map(String)
      : selectedWidget?.chartQuery?.x
        ? [String(selectedWidget.chartQuery.x)]
        : [];
    const curMode = (selectedWidget?.chartQuery as any)?.mode || 'single';
    const titleSame = pendingTitle === (selectedWidget?.title || '');
    const fieldsSame =
      fields.length === curFields.length && fields.every((f, i) => f === curFields[i]);
    const modeSame = pendingSlicerMode === curMode;
    if (titleSame && fieldsSame && modeSame) return;
    const timer = window.setTimeout(() => {
      applySlicerChanges({
        title: pendingTitle,
        field: fields[0],
        fields,
        mode: pendingSlicerMode,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    hasWidget,
    isSlicer,
    pendingTitle,
    pendingSlicerField,
    pendingSlicerFields,
    pendingSlicerMode,
    selectedWidget?.title,
    selectedWidget?.chartQuery,
    applySlicerChanges,
  ]);

  // selectedTableColumns is already {label, value, type}[] from useWidgetProperties
  const columnOptions = selectedTableColumns || [];

  const switchSqlToTable = () => {
    setSqlEditorOpen(false);
    void bindSavedQuery(undefined);
    updateWidgetRoot('chartOptions', {
      ...(selectedWidget?.chartOptions || {}),
      sample_sql: undefined,
      __prefetchedChartData: undefined,
      __echartsSnapshot: undefined,
    });
  };

  const setDatasetMode = (mode: string | number) => {
    if (mode === 'table') {
      if (sqlBound) {
        Modal.confirm({
          title: tDash('switch_to_table_title'),
          content: tDash('switch_to_table_body'),
          okText: tDash('switch_to_table_ok'),
          okButtonProps: { danger: true },
          cancelText: tDash('switch_to_table_cancel'),
          onOk: () => switchSqlToTable(),
        });
      }
      return;
    }
    if (mode === 'query' && !sqlBound) {
      setSqlEditorOpen(true);
    }
  };

  const handleApply = async () => {
    if (!hasWidget) return;

    if (isSlicer) {
      const fields =
        pendingSlicerFields.length > 0
          ? pendingSlicerFields
          : pendingSlicerField
            ? [pendingSlicerField]
            : [];
      applySlicerChanges({
        title: pendingTitle,
        field: fields[0],
        fields,
        mode: pendingSlicerMode,
      });
      return;
    }

    // Force persist/refetch so Build/Format edits recompute (clears pin freeze / failed-query blocks).
    setApplyLoading(true);
    try {
      const titleForSync = isDesigner ? selectedWidget?.title || pendingTitle : pendingTitle;
      await forceSyncChart({ title: titleForSync });
    } catch (err) {
      console.error('Refresh chart failed:', err);
    } finally {
      setApplyLoading(false);
    }
  };

  // ── Build tab ────────────────────────────────────────────────────────────────
  const contentBlockLabel =
    selectedWidget?.chartType === 'text'
      ? tDash('type_text')
      : selectedWidget?.chartType === 'image'
        ? tDash('type_image')
        : selectedWidget?.chartType === 'embed'
          ? tDash('type_embed')
          : selectedWidget?.chartType === 'divider'
            ? tDash('type_divider')
            : selectedWidget?.chartType;

  const buildTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : isContentBlock ? (
        <>
          {!isDesigner && (
            <div>
              <PpLabel>{tDash('widget_title_label')}</PpLabel>
              <Input
                value={pendingTitle}
                onChange={(e) => setPendingTitle(e.target.value)}
                placeholder={tDash('widget_title_placeholder')}
                size="small"
              />
            </div>
          )}
          <div className="pp-format-section">
            <PpLabel>{tDash('block_type_label')}</PpLabel>
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 8 }}>
              {contentBlockLabel}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
              {tDash('content_block_build_hint')}
            </div>
          </div>
        </>
      ) : (
        <>
          {!isDesigner && (
            <div>
              <PpLabel>{tDash('widget_title_label')}</PpLabel>
              <Input
                value={pendingTitle}
                onChange={(e) => setPendingTitle(e.target.value)}
                placeholder={tDash('widget_title_placeholder')}
                size="small"
              />
            </div>
          )}

          <div>
            <PpLabel>{tDash('data_source_label')}</PpLabel>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={selectedWidget?.dataSourceId ? String(selectedWidget.dataSourceId) : undefined}
              onChange={confirmDataSourceChange}
              options={dataSourceOptions}
              placeholder={tDash('data_source_placeholder')}
              loading={isLoading}
              allowClear
              showSearch
              filterOption={(input, opt) =>
                String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          {!isSlicer && selectedWidget?.dataSourceId ? (
            <div>
              <PpLabel>{tDash('dataset_label')}</PpLabel>
              <Segmented
                size="small"
                block
                value={sqlBound || sqlEditorOpen ? 'query' : 'table'}
                options={[
                  { label: tDash('dataset_table'), value: 'table' },
                  { label: tDash('dataset_query'), value: 'query' },
                ]}
                onChange={setDatasetMode}
              />
            </div>
          ) : null}

          {!isSlicer && (
            <>
              <SavedQueryPicker
                value={selectedWidget?.chartQuery?.saved_query_id}
                onChange={(id, snap) => {
                  void bindSavedQuery(id, snap);
                }}
                labelExtra={
                  !sqlBound && !sqlEditorOpen ? (
                    <Tooltip title={tDash('write_custom_sql')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<CodeOutlined />}
                        onClick={() => setSqlEditorOpen(true)}
                        aria-label={tDash('write_custom_sql')}
                      />
                    </Tooltip>
                  ) : null
                }
              />
              {(sqlBound || sqlEditorOpen) && (
                <SavedQuerySqlEditor
                  savedQueryId={selectedWidget?.chartQuery?.saved_query_id}
                  sampleSql={
                    typeof selectedWidget?.chartOptions?.sample_sql === 'string'
                      ? selectedWidget.chartOptions.sample_sql
                      : null
                  }
                  dataSourceId={selectedWidget?.dataSourceId}
                  chartTitle={isDesigner ? selectedWidget?.title : pendingTitle || selectedWidget?.title}
                  forceShow={sqlEditorOpen}
                  onSavedQueryBound={(id, snap) => bindSavedQuery(id, snap)}
                  onSampleSqlChange={(sql) =>
                    updateWidgetRoot('chartOptions', {
                      ...(selectedWidget?.chartOptions || {}),
                      sample_sql: sql,
                    })
                  }
                  onAfterSave={async () => {
                    if (selectedWidgetId) {
                      await forceSyncChart();
                    }
                  }}
                  onSwitchToTable={switchSqlToTable}
                />
              )}
            </>
          )}

          {!sqlBound && !selectedWidget?.chartQuery?.saved_query_id && tableOptions.length > 0 && (
            <div>
              <PpLabel>{tDash('table_label')}</PpLabel>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={(selectedWidget as any)?.chartQuery?.tableName}
                onChange={(val) => {
                  setSqlEditorOpen(false);
                  updateChartQuery('tableName', val);
                  if (selectedWidget?.chartOptions?.sample_sql) {
                    updateWidgetRoot('chartOptions', {
                      ...(selectedWidget.chartOptions || {}),
                      sample_sql: undefined,
                    });
                  }
                }}
                options={tableOptions}
                placeholder={tDash('table_placeholder')}
                loading={schemaLoading}
                allowClear={tableOptions.length > 1}
                showSearch
              />
            </div>
          )}

          {hasWidget && !isSlicer && (columnOptions.length > 0 || savedQueryColumnsLoading || schemaLoading) ? (
            <AvailableFieldsPanel
              columns={columnOptions}
              dataSourceId={selectedWidget?.dataSourceId}
              tableName={selectedWidget?.chartQuery?.tableName}
              loading={Boolean(savedQueryColumnsLoading || (schemaLoading && columnOptions.length === 0))}
            />
          ) : null}

          {isSlicer ? (
            /* ---- Slicer-specific fields ---- */
            <>
              <div>
                <PpLabel>{tDash('filter_fields_label')}</PpLabel>
                <div
                  className="pp-field-drop-shell"
                  onDragOver={(event) => {
                    if (!isDashboardFieldDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(event) => {
                    const field = getDashboardFieldDragData(event.dataTransfer);
                    if (!field) return;
                    event.preventDefault();
                    setPendingSlicerField(field.columnName);
                    setPendingSlicerFields((current) =>
                      current.includes(field.columnName) ? current : [...current, field.columnName],
                    );
                    applyDroppedField('slicerField', field);
                  }}
                >
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    mode="multiple"
                    value={pendingSlicerFields}
                    onChange={(values) => {
                      setPendingSlicerFields(values);
                      setPendingSlicerField(values[0]);
                    }}
                    options={columnOptions}
                    placeholder={
                      !selectedWidget?.dataSourceId
                        ? 'Select a data source first'
                        : schemaLoading
                        ? 'Loading columns...'
                        : 'Select filter field'
                    }
                    loading={schemaLoading}
                    allowClear
                    maxTagCount={3}
                    showSearch
                    filterOption={(input, opt) =>
                      String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
              </div>

              <div>
                <PpLabel>{tDash('slicer_type_label')}</PpLabel>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={pendingSlicerMode}
                  onChange={setPendingSlicerMode}
                  options={[
                    { label: 'Dropdown (single)', value: 'single' },
                    { label: 'Dropdown (multi-select)', value: 'multi' },
                    { label: 'Tile / Button list', value: 'tile' },
                    { label: 'Date picker', value: 'date' },
                    { label: 'Date range', value: 'dateRange' },
                    { label: 'Numeric range slider', value: 'numericRange' },
                    { label: 'On / Off toggle', value: 'toggle' },
                  ]}
                />
              </div>
            </>
          ) : (
            /* ---- Chart-specific fields ---- */
            <>
              <div>
                <PpLabel>{tDash('chart_type_label')}</PpLabel>
                <div className="pp-chart-type-row">
                  {CHART_TYPES.map(({ type, icon, label }) => (
                    <Tooltip key={type} title={label} placement="top">
                      <button
                        className={`pp-chart-type-btn${pendingChartType === type ? ' active' : ''}`}
                        onClick={() => {
                          setPendingChartType(type);
                          // Commit chart type immediately (no data change, just visual)
                          updateWidgetRoot('chartType', type);
                        }}
                        aria-label={label}
                      >
                        {icon}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Full field mapping — renders the correct fields for each chart type */}
              <ChartSpecificFields
                chartType={selectedWidget.chartType || pendingChartType || 'bar'}
                chartQuery={selectedWidget.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns || []}
                isLoading={schemaLoading || savedQueryColumnsLoading}
                onUpdateChartQuery={updateChartQuery}
                onFieldDrop={applyDroppedField}
                chartOptions={selectedWidget.chartOptions || {}}
                onUpdateChartOption={(key, val) =>
                  updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
                }
                mode="mapping"
                fetchDistinctValues={fetchVisualDistinctValues}
                sqlBound={sqlBound}
              />

              {/* Joins — table mode only, under More */}
              {!sqlBound && selectedWidget?.dataSourceId ? (
                <Collapse
                  size="small"
                  ghost
                  className="pp-advanced-collapse"
                  style={{ marginTop: 8 }}
                  defaultActiveKey={
                    (selectedWidget.chartQuery?.joins || []).length > 0 ? ['joins'] : []
                  }
                  items={[
                    {
                      key: 'joins',
                      label: (
                        <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                          {tDash('joins_label')}
                        </span>
                      ),
                      children: (
                        <RelatedJoinsPicker
                          dataSourceId={selectedWidget.dataSourceId}
                          baseTable={selectedWidget.chartQuery?.tableName}
                          joins={selectedWidget.chartQuery?.joins || []}
                          onChange={(joins) => updateChartQuery('joins', joins)}
                        />
                      ),
                    },
                  ]}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );

  // ── Format tab ───────────────────────────────────────────────────────────────
  const formatTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : isSlicer ? (
        <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12, padding: 8 }}>
          Format options not available for slicers.
        </div>
      ) : isContentBlock ? (
        <ChartSpecificFields
          chartType={selectedWidget.chartType || 'text'}
          chartQuery={selectedWidget.chartQuery || {}}
          selectedWidget={selectedWidget}
          selectedTableColumns={[]}
          onUpdateChartQuery={updateChartQuery}
          chartOptions={selectedWidget.chartOptions || {}}
          onUpdateChartOption={(key, val) =>
            updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
          }
          onUpdateChartOptions={(updates) =>
            updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
          }
          mode="customize"
        />
      ) : (
        <>
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            onFieldDrop={applyDroppedField}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key, val) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
            }
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
            mode="customize"
            sqlBound={sqlBound}
          />
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            onFieldDrop={applyDroppedField}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key, val) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
            }
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
            mode="colors"
            sqlBound={sqlBound}
          />
          <ChartOptions
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            chartQuery={selectedWidget.chartQuery || {}}
            onUpdateChartOption={(key, value) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: value })
            }
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
          />
        </>
      )}
    </div>
  );

  // ── Filters tab — unchanged ──────────────────────────────────────────────────
  const allFilters = [...globalFiltersConfig, ...pageFiltersConfig];

  const filtersTab = (
    <div className="properties-panel-body">
      {/* Page-level Filters */}
      <div>
        <PpLabel>{tDash('page_filters_label')}</PpLabel>
        {allFilters.length === 0 ? (
          <div className="pp-filter-empty">
            <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 12, marginBottom: 8 }}>
              {tDash('page_filters_empty')}
            </div>
            {onOpenManageFilters ? (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={onOpenManageFilters}>
                {tDash('page_filters_manage_cta')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {allFilters.map((filter) => {
              const active = runtimeFilters.find((rf) => rf.field === filter.field);
              const currentValue = active?.value;
              const valueAsArray: string[] = Array.isArray(currentValue)
                ? (currentValue as string[])
                : currentValue != null
                ? [String(currentValue)]
                : [];
              const fallbackDs =
                filter.dataSourceId ||
                selectedWidget?.dataSourceId ||
                widgets.find((w: any) => w.dataSourceId)?.dataSourceId;
              const fallbackTable =
                filter.tableName ||
                selectedWidget?.chartQuery?.tableName;
              const displayName = filter.name || filter.field;
              return (
                <div key={filter.id || filter.field}>
                  <div className="pp-section-label" style={{ marginTop: 0 }}>
                    {displayName}
                  </div>
                  <PageFilterValueSelect
                    filter={filter}
                    runtimeFilters={runtimeFilters}
                    valueAsArray={valueAsArray}
                    fetchOptions={fetchFilterOptions}
                    fallbackDataSourceId={fallbackDs ? String(fallbackDs) : undefined}
                    fallbackTableName={fallbackTable ? String(fallbackTable) : undefined}
                    onChange={(vals: string[]) => {
                      if (!onRuntimeFiltersChange) return;
                      const others = runtimeFilters.filter((rf) => rf.field !== filter.field);
                      onRuntimeFiltersChange(
                        vals.length > 0
                          ? [...others, { field: filter.field, operator: 'in', value: vals, type: 'simple' as const }]
                          : others,
                      );
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visual-level Filters — same builders as Analytics; live on this widget only */}
      {hasWidget && !isSlicer && (
        <div>
          <PpLabel>{tDash('visual_filters_label')}</PpLabel>
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            onFieldDrop={applyDroppedField}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key, val) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
            }
            mode="filters"
            fetchDistinctValues={fetchVisualDistinctValues}
            sqlBound={sqlBound}
          />
        </div>
      )}
    </div>
  );

  // ── Analytics tab ────────────────────────────────────────────────────────────
  const analyticsTab = (
    <div className="properties-panel-body">
      {!hasWidget || isSlicer || isContentBlock ? (
        <div className="pp-empty-state">
          {isSlicer
            ? tDash('interact_not_for_slicer')
            : isContentBlock
              ? tDash('interact_not_for_content')
              : tDash('select_widget_prompt')}
        </div>
      ) : (
        <ChartSpecificFields
          chartType={selectedWidget.chartType || 'bar'}
          chartQuery={selectedWidget.chartQuery || {}}
          selectedWidget={selectedWidget}
          selectedTableColumns={selectedTableColumns || []}
          isLoading={schemaLoading}
          onUpdateChartQuery={updateChartQuery}
          onFieldDrop={applyDroppedField}
          chartOptions={selectedWidget.chartOptions || {}}
          onUpdateChartOption={(key, val) =>
            updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
          }
          mode="advanced"
          dashboardPages={dashboardPages}
          sqlBound={sqlBound}
        />
      )}
    </div>
  );

  return (
    <aside
      className={`properties-panel${isCollapsed ? ' collapsed' : ''}`}
      aria-label={isCollapsed ? undefined : 'Widget properties'}
      aria-hidden={isCollapsed}
    >
      {!isCollapsed ? (
        <>
          <div className="properties-panel-header">
            <span className="properties-panel-header-label">Properties</span>
            {onCollapse ? (
              <Tooltip title="Collapse panel">
                <Button
                  type="text"
                  size="small"
                  className="properties-panel-collapse-btn"
                  icon={<MenuUnfoldOutlined />}
                  aria-label="Collapse properties panel"
                  onClick={onCollapse}
                />
              </Tooltip>
            ) : null}
          </div>
          <Tabs
            className="properties-panel-tabs"
            size="small"
            items={[
              {
                key: 'build',
                label: (
                  <Tooltip title={tDash('tab_build_tip')}>
                    <span>{tDash('tab_build')}</span>
                  </Tooltip>
                ),
                children: buildTab,
              },
              {
                key: 'format',
                label: (
                  <Tooltip title={tDash('tab_format_tip')}>
                    <span>{tDash('tab_format')}</span>
                  </Tooltip>
                ),
                children: formatTab,
              },
              {
                key: 'filters',
                label: (
                  <Tooltip title={tDash('tab_filters_tip')}>
                    <span>{tDash('tab_filters')}</span>
                  </Tooltip>
                ),
                children: filtersTab,
              },
              {
                key: 'interact',
                label: (
                  <Tooltip title={tDash('tab_interact_tip')}>
                    <span>{tDash('tab_interact')}</span>
                  </Tooltip>
                ),
                children: analyticsTab,
              },
            ]}
          />
          <div className="properties-panel-footer">
            <Button
                type="primary"
                block
                size="small"
                disabled={!hasWidget || applyLoading}
                loading={applyLoading}
                onClick={handleApply}
              >
                {tDash('refresh_chart')}
              </Button>
            {hasWidget && (
              <Button
                type="link"
                danger
                block
                size="small"
                onClick={() => removeWidget(selectedWidgetId!)}
              >
                {tDash('delete_widget')}
              </Button>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
};
