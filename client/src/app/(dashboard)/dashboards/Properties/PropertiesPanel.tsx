'use client';

import { CheckboxField } from './FormFields';
import React, { useState, useEffect, useMemo } from 'react';
import { useDataSource } from '@/hooks/useDataSources';
import { Tabs, Input, Select, Button, Tooltip, Collapse, Modal, Segmented, Typography, Alert, message } from 'antd';
import {
  MenuUnfoldOutlined,
  CodeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { ChartAnnotations } from './ChartAnnotations';
import { ChartAnalytics } from './ChartAnalytics';
import { ChartTextFields } from './ChartTextFields';
import { ChartNotesFields } from './ChartNotesFields';
import { ChartInlineEditor } from './ChartInlineEditor';
import { chartSource, sourcePatch } from '../utils/chartAnnotations';
import { useWidgetProperties } from '../hooks/useWidgetProperties';
import { ChartOptions } from './ChartOptions';
import { ChartDesignControls } from './ChartDesignControls';
import { ChartSpecificFields } from './ChartSpecificFields';
import { SavedQueryPicker } from './SavedQueryPicker';
import { SavedQuerySqlEditor } from './SavedQuerySqlEditor';
import { AvailableFieldsPanel } from './AvailableFieldsPanel';
import { PpLabel } from './PpLabel';
import { PageFilterValueSelect } from './PageFilterValueSelect';
import { RelatedJoinsPicker } from './RelatedJoinsPicker';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useChartDesignerStore } from '@/app/(dashboard)/chart-designer/stores/useChartDesignerStore';
import type { DashboardFilter } from '@/types/dashboard';
import type { RuntimeFilter } from '../utils/filterOperators';
import { getDashboardFieldDragData, isDashboardFieldDrag } from '../utils/dashboardFieldDrag';
import { enhancedDataService } from '@/services/enhancedDataService';
import { useTranslations } from 'next-intl';
import { isContentWidgetType, isControlWidgetType } from './widgetPropertyProfile';
import { duplicateKpis, isEmptyDataWidget, kpiSignature, planEmptyWidgetBindings, planKpiVariety } from '../utils/bindEmptyWidgets';
import { AUTO_TITLE_KEY, deriveAutoTitle, isAutoTitle } from '../utils/widgetAutoTitle';
import { buildDashboardChartTypeSwitcherOptions } from './dashboardChartTypeSwitcher';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { isSafeChartTypeSwitchTarget } from '@/components/charts/chartTypeCatalog';
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
  /** Opens Data Modeling when a multi-table source has no relationships yet. */
  onOpenDataModeling?: () => void;
}

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
  onOpenDataModeling,
}) => {
  const {
    dataSources,
    selectedTableColumns,
    availableTables,
    effectiveTableName,
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

  const dashUpdateChartAndFetchData = useDashboardStore((s) => s.updateChartAndFetchData);
  const desUpdateChartAndFetchData = useChartDesignerStore((s) => s.updateChartAndFetchData);
  const persistChartMeta = isDesigner ? desUpdateChartAndFetchData : dashUpdateChartAndFetchData;

  const sqlBound = Boolean(
    isSqlBoundWidget ||
      selectedWidget?.chartQuery?.saved_query_id ||
      selectedWidget?.chartQuery?.query_snapshot_id ||
      (typeof selectedWidget?.chartOptions?.sample_sql === 'string' &&
        selectedWidget.chartOptions.sample_sql.trim()),
  );
  const [sqlEditorOpen, setSqlEditorOpen] = useState(false);
  /** Types that need a different data shape stay out of the way until asked for. */
  const [showAllChartTypes, setShowAllChartTypes] = useState(false);
  /** In the Designer the thing is a chart; on a dashboard it's a card on the page. */
  const deleteLabelKey = isDesigner ? 'delete_chart' : 'delete_widget';
  /** The X axis has an order (dates, numbers), so a trend or an "unusual" point means something. */
  const orderedXAxis = React.useMemo(() => {
    const q = (selectedWidget?.chartQuery || {}) as Record<string, unknown>;
    if (selectedWidget?.chartType === 'scatter' || q.xGrain) return true;
    const type = String(
      (selectedTableColumns || []).find((c: any) => c.value === q.x)?.type || '',
    ).toUpperCase();
    return type.includes('DATE') || type.includes('TIME');
  }, [selectedWidget?.chartType, selectedWidget?.chartQuery, selectedTableColumns]);
  const tDash = useTranslations('dashboards');
  const eeEnabled = isEnterpriseEdition();
  const [applyLoading, setApplyLoading] = useState(false);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const storeUpdateWidget = useDashboardStore((s) => s.updateWidget);
  const storeCreateChartAndFetchData = useDashboardStore((s) => s.createChartAndFetchData);
  const tStory = useTranslations('dashboards_page');
  /** Titles layouts give their empty slots ("KPI", "Trend"…), translated. */
  const kpiPlaceholders = React.useMemo(
    () =>
      ['story_slot_kpi', 'story_slot_trend', 'story_slot_compare', 'story_slot_share', 'story_slot_detail'].map((k) =>
        tStory(k as never),
      ),
    [tStory],
  );
  const [bindingEmpty, setBindingEmpty] = useState(false);

  // F-DASH-03: once this widget has a table, offer to give every still-empty widget the same data.
  const emptyOtherWidgets = useMemo(
    () => (widgets || []).filter((w: any) => w?.id !== selectedWidgetId && isEmptyDataWidget(w)),
    [widgets, selectedWidgetId],
  );
  const selectedSourceId = selectedWidget?.dataSourceId as string | undefined;
  const selectedTable = (selectedWidget?.chartQuery?.tableName as string | undefined) || effectiveTableName;
  const canBindEmpty =
    !isDesigner && !sqlBound && Boolean(selectedSourceId && selectedTable) && emptyOtherWidgets.length > 0;

  const bindEmptyWidgets = async () => {
    if (!selectedSourceId || !selectedTable) return;
    const columns = (selectedTableColumns || [])
      .filter((c: any) => !String(c.value).includes('.'))
      .map((c: any) => ({ name: String(c.value), type: String(c.type || '') }));
    const placeholders = new Set(
      ['story_slot_kpi', 'story_slot_trend', 'story_slot_compare', 'story_slot_share', 'story_slot_detail'].map((k) =>
        tStory(k as any),
      ),
    );
    const plan = planEmptyWidgetBindings(
      emptyOtherWidgets,
      { dataSourceId: selectedSourceId, tableName: selectedTable },
      columns,
      {
        placeholderTitles: placeholders,
        taken: (widgets || []).flatMap((w: any) =>
          Array.isArray(w?.chartQuery?.yMetrics) ? w.chartQuery.yMetrics : [],
        ),
      },
    );
    setBindingEmpty(true);
    try {
      for (const b of plan) {
        const w = emptyOtherWidgets.find((x: any) => x.id === b.id);
        if (!w) continue;
        // Placeholder titles become automatic ones, which then follow later edits and type switches.
        const title = b.title
          ? deriveAutoTitle({ ...w, chartQuery: b.chartQuery }, tStory as never) || b.title
          : undefined;
        const patch = {
          dataSourceId: b.dataSourceId,
          chartQuery: b.chartQuery,
          ...(title
            ? { title, chartOptions: { ...(w.chartOptions || {}), [AUTO_TITLE_KEY]: title } }
            : {}),
        };
        storeUpdateWidget(b.id, patch);
        // eslint-disable-next-line no-await-in-loop -- one at a time keeps DB connections calm
        await (w.chartId
          ? dashUpdateChartAndFetchData(b.id, patch)
          : storeCreateChartAndFetchData({ ...w, ...patch }));
      }
    } finally {
      setBindingEmpty(false);
    }
  };

  // KPI cards that show the same number as another card (older "Use this data" runs, copies).
  // One click gives each repeat something new from the same table; Undo puts them back.
  const repeatedKpis = React.useMemo(() => {
    const sig = selectedWidget ? kpiSignature(selectedWidget) : null;
    if (!sig || isDesigner) return [];
    const all = (widgets || []) as any[];
    const group = all.filter((w) => kpiSignature(w) === sig);
    return group.length > 1 ? duplicateKpis(group) : [];
  }, [selectedWidget, widgets, isDesigner]);

  // Only offered when the table has something new for at least one repeat.
  const kpiVarietyPlan = React.useMemo(() => {
    if (!repeatedKpis.length) return [];
    const columns = (selectedTableColumns || [])
      .filter((c: any) => !String(c.value).includes('.'))
      .map((c: any) => ({ name: String(c.value), type: String(c.type || '') }));
    const taken = (widgets || []).flatMap((w: any) => (Array.isArray(w?.chartQuery?.yMetrics) ? w.chartQuery.yMetrics : []));
    return planKpiVariety(repeatedKpis, columns, taken);
  }, [repeatedKpis, selectedTableColumns, widgets]);

  const varyRepeatedKpis = async () => {
    const plan = kpiVarietyPlan;
    if (!plan.length) return;
    const before = plan.map((b) => {
      const w = (widgets || []).find((x: any) => x.id === b.id) as any;
      return { id: b.id, chartQuery: w.chartQuery, title: w.title, chartOptions: w.chartOptions };
    });
    const apply = async (patches: Array<{ id: string; patch: Record<string, unknown> }>) => {
      for (const { id, patch } of patches) {
        storeUpdateWidget(id, patch);
        // eslint-disable-next-line no-await-in-loop -- one at a time keeps DB connections calm
        await dashUpdateChartAndFetchData(id, patch);
      }
    };
    setBindingEmpty(true);
    try {
      await apply(
        plan.map((b) => {
          const w = before.find((x) => x.id === b.id)!;
          const next = { ...w, chartQuery: b.chartQuery } as any;
          // A placeholder or automatic title follows the new metric; a typed one is kept.
          const title = isAutoTitle(w as any, kpiPlaceholders) ? deriveAutoTitle(next, tStory as never) : null;
          return {
            id: b.id,
            patch: {
              chartQuery: b.chartQuery,
              ...(title ? { title, chartOptions: { ...(w.chartOptions || {}), [AUTO_TITLE_KEY]: title } } : {}),
            },
          };
        }),
      );
    } finally {
      setBindingEmpty(false);
    }
    const key = 'kpi-repeats-varied';
    message.open({
      key,
      type: 'success',
      duration: 6,
      content: (
        <span>
          {tDash('kpi_repeats_varied', { count: plan.length })}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => {
              message.destroy(key);
              void apply(
                before.map((b) => ({
                  id: b.id,
                  patch: { chartQuery: b.chartQuery, title: b.title, chartOptions: b.chartOptions },
                })),
              );
            }}
          >
            {tDash('undo')}
          </Button>
        </span>
      ),
    });
  };

  const fetchFilterOptions = React.useCallback(
    async (
      field: string,
      dataSourceId: string,
      ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
    ) => {
      // Designer has no dashboard — page-filter pickers are unavailable there.
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
      if (!dsId) return [];
      try {
        const { normalizeFilterOptions, unwrapFilterOptionsResponse } = await import(
          '../utils/filterOperators'
        );

        // SQL-bound: distincts from the query result, not a physical table.
        // Works in Chart Designer without a dashboard id.
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

        // Table mode on a dashboard: use dashboard filter-options (scoped).
        if (activeDashboardId) {
          const { chartService } = await import('../services/chartService');
          const raw = await chartService.getFilterOptions(activeDashboardId, field, String(dsId), {
            tableName: selectedWidget?.chartQuery?.tableName,
          });
          return normalizeFilterOptions(unwrapFilterOptionsResponse(raw));
        }

        // Designer table mode: DISTINCT via adhoc SQL on the mapped table.
        const tableName = selectedWidget?.chartQuery?.tableName;
        if (tableName) {
          const safeTable = String(tableName).replace(/"/g, '""');
          const safeField = String(field).replace(/"/g, '""');
          const distinctSql = `SELECT DISTINCT "${safeField}" AS v FROM "${safeTable}" WHERE "${safeField}" IS NOT NULL LIMIT 500`;
          const result = await enhancedDataService.executeMultiEngineQuery(
            distinctSql,
            String(dsId),
          );
          const rows = (result as { data?: Array<Record<string, unknown>> })?.data || [];
          return rows
            .map((r) => r.v ?? r.V ?? Object.values(r)[0])
            .filter((v) => v != null && String(v).trim() !== '')
            .map((v) => ({ label: String(v), value: String(v) }));
        }
        return [];
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

  // A chart can point at a source outside the current project's list (built elsewhere, or
  // moved). Name it instead of showing its raw id.
  const boundSourceId = selectedWidget?.dataSourceId ? String(selectedWidget.dataSourceId) : null;
  const boundSourceListed = !boundSourceId || (dataSources || []).some((ds: any) => String(ds.id) === boundSourceId);
  const { dataSource: unlistedSource, error: unlistedSourceError } = useDataSource(
    boundSourceListed ? null : boundSourceId,
  );
  const dataSourceOptions = [
    ...(dataSources || []).map((ds: any) => ({
      value: String(ds.id),
      label: ds.name || ds.id,
    })),
    ...(!boundSourceListed && boundSourceId
      ? [{
          value: boundSourceId,
          label: unlistedSource?.name
            ? tDash('data_source_other_project', { name: unlistedSource.name })
            : unlistedSourceError
              ? tDash('data_source_unavailable')
              : '…',
        }]
      : []),
  ];

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

  // Safe switch targets (core 8) plus the widget's own current type if it's one of the
  // extended 7 (e.g. AI-authored Geo/Heatmap) — keeps that button visible/active instead of
  // offering a switch that would silently break the widget's data. See dashboardChartTypeSwitchTargets.
  // A placeholder title ("Line" on a bar, "KPI" on a pie) gets a data-based suggestion, one
  // click to accept; nothing is renamed behind the user's back.
  const suggestedTitle = React.useMemo(() => {
    if (!selectedWidget || isSlicer || isContentBlock) return null;
    if (!isAutoTitle(selectedWidget, kpiPlaceholders)) return null;
    const derived = deriveAutoTitle(selectedWidget, tStory as never);
    return derived && derived !== pendingTitle ? derived : null;
  }, [selectedWidget, isSlicer, isContentBlock, tStory, pendingTitle, kpiPlaceholders]);

  const chartTypeSwitcherOptions = useMemo(
    () => buildDashboardChartTypeSwitcherOptions(selectedWidget?.chartType, selectedWidget?.chartQuery as never),
    [selectedWidget?.chartType, selectedWidget?.chartQuery],
  );

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
      // Persist title to the library chart (local-only update was lost on reload).
      if (selectedWidgetId && selectedWidget?.chartId) {
        void persistChartMeta(selectedWidgetId, { title: pendingTitle });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    pendingTitle,
    hasWidget,
    isDesigner,
    isSlicer,
    selectedWidget?.title,
    selectedWidget?.chartId,
    selectedWidgetId,
    updateWidgetRoot,
    persistChartMeta,
  ]);

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
      } else {
        // Nothing was bound to SQL yet: just close the editor and keep the table's fields.
        setSqlEditorOpen(false);
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
        <div className="pp-empty-state">{tDash('select_widget_prompt')}</div>
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
              {suggestedTitle ? (
                <div className="pp-title-suggestion">
                  {tDash('title_suggestion')}{' '}
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setPendingTitle(suggestedTitle);
                      updateWidgetRoot('chartOptions', {
                        ...(selectedWidget?.chartOptions || {}),
                        [AUTO_TITLE_KEY]: suggestedTitle,
                      });
                    }}
                  >
                    {suggestedTitle}
                  </Button>
                </div>
              ) : null}
              {kpiVarietyPlan.length > 0 ? (
                <div className="pp-title-suggestion pp-kpi-repeats">
                  {tDash('kpi_repeats', { count: repeatedKpis.length + 1 })}{' '}
                  <Button type="link" size="small" onClick={varyRepeatedKpis} loading={bindingEmpty}>
                    {tDash('kpi_repeats_fix')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          {/* What kind of visual first (Datawrapper / Canva order), then the data behind it. */}
          {!isSlicer ? (
                <div>
                  <PpLabel>{tDash('chart_type_label')}</PpLabel>
                  <div className="pp-chart-type-row">
                    {chartTypeSwitcherOptions
                      .filter((o) => !o.disabled || showAllChartTypes)
                      .map(({ type, icon, label, disabled, disabledReason }) => {
                        const name = tDash.has(`chart_type_name_${type}` as never)
                          ? tDash(`chart_type_name_${type}` as never)
                          : label;
                        return (
                          <Tooltip
                            key={type}
                            title={
                              disabled
                                ? tDash.has(`chart_type_needs_${type}` as never)
                                  ? tDash('chart_type_needs', {
                                      chart: name,
                                      needs: tDash(`chart_type_needs_${type}` as never),
                                    })
                                  : disabledReason || name
                                : null
                            }
                            placement="top"
                          >
                            {/* A disabled button gets no mouse events, so the tooltip needs a wrapper. */}
                            <span className="pp-chart-type-btn-wrap">
                              <button
                                type="button"
                                className={`pp-chart-type-btn${pendingChartType === type ? ' active' : ''}${disabled ? ' is-disabled' : ''}`}
                                disabled={disabled}
                                onClick={() => {
                                  if (disabled) return;
                                  setPendingChartType(type);
                                  // Chart type can change aggregation shape — commit +
                                  // let auto-sync refetch when the mapping is runnable.
                                  updateWidgetRoot('chartType', type);
                                }}
                                aria-pressed={pendingChartType === type}
                                aria-disabled={disabled || undefined}
                              >
                                <span className="pp-chart-type-icon" aria-hidden>
                                  {icon}
                                </span>
                                <span className="pp-chart-type-name">{name}</span>
                              </button>
                            </span>
                          </Tooltip>
                        );
                      })}
                  </div>
                  {chartTypeSwitcherOptions.some((o) => o.disabled) ? (
                    <Button
                      type="link"
                      size="small"
                      className="pp-chart-type-more"
                      onClick={() => setShowAllChartTypes((v) => !v)}
                    >
                      {showAllChartTypes
                        ? tDash('chart_types_fewer')
                        : tDash('chart_types_more', { count: chartTypeSwitcherOptions.filter((o) => o.disabled).length })}
                    </Button>
                  ) : null}
                </div>
          ) : null}

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
              status={!boundSourceListed && unlistedSource ? 'error' : undefined}
            />
            {!boundSourceListed && unlistedSource ? (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 6 }}
                message={tDash('data_source_other_project_blocked')}
              />
            ) : null}
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

          {!isSlicer && (sqlBound || sqlEditorOpen) && (
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

          {!sqlBound && !sqlEditorOpen && !selectedWidget?.chartQuery?.saved_query_id && tableOptions.length > 0 && (
            <div>
              <PpLabel>{tDash('table_label')}</PpLabel>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={effectiveTableName ?? (selectedWidget as any)?.chartQuery?.tableName}
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

          {canBindEmpty ? (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 8 }}
              message={tDash('bind_empty_widgets_title', { count: emptyOtherWidgets.length })}
              action={
                <Button size="small" type="primary" loading={bindingEmpty} onClick={() => void bindEmptyWidgets()}>
                  {tDash('bind_empty_widgets_cta')}
                </Button>
              }
            />
          ) : null}

          {hasWidget && isSlicer && (columnOptions.length > 0 || savedQueryColumnsLoading || schemaLoading) ? (
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
          ) : sqlEditorOpen && !sqlBound ? (
            /* Query mode before a query exists: the table's shelves would drive the chart, so wait. */
            <Typography.Text type="secondary" className="pp-query-first-hint">
              {tDash('query_mode_pick_first')}
            </Typography.Text>
          ) : (
            /* ---- Chart-specific fields ---- */
            <>
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

              {/* All fields of the table, as a drag source for the shelves above. */}
              {hasWidget && (columnOptions.length > 0 || savedQueryColumnsLoading || schemaLoading) ? (
                <AvailableFieldsPanel
                  columns={columnOptions}
                  dataSourceId={selectedWidget?.dataSourceId}
                  tableName={selectedWidget?.chartQuery?.tableName}
                  loading={Boolean(savedQueryColumnsLoading || (schemaLoading && columnOptions.length === 0))}
                />
              ) : null}

              {/* Related tables — progressive disclosure; nudge when model is missing */}
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
                        <>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
                          >
                            {tDash('joins_help')}
                          </Typography.Text>
                          <RelatedJoinsPicker
                            dataSourceId={selectedWidget.dataSourceId}
                            baseTable={selectedWidget.chartQuery?.tableName}
                            joins={selectedWidget.chartQuery?.joins || []}
                            onChange={(joins) => updateChartQuery('joins', joins)}
                            onOpenDataModeling={onOpenDataModeling}
                          />
                        </>
                      ),
                    },
                  ]}
                />
              ) : null}
            </>
          )}
          {!isSlicer && !isContentBlock && hasWidget && !(sqlEditorOpen && !sqlBound) ? (
            <ChartSpecificFields
              chartType={selectedWidget.chartType || 'bar'}
              chartQuery={selectedWidget.chartQuery || {}}
              selectedWidget={selectedWidget}
              selectedTableColumns={selectedTableColumns || []}
              onUpdateChartQuery={updateChartQuery}
              chartOptions={selectedWidget.chartOptions || {}}
              mode="sort"
              sqlBound={sqlBound}
            />
          ) : null}
          {/* Annotate last (Datawrapper order): data first, then the words around the chart. */}
          {!isSlicer && hasWidget ? (
            <ChartAnnotations
              subtitle={selectedWidget?.chartOptions?.subtitle}
              sourceNote={
                // The raw text, not the trimmed display value: trimming here ate every space typed.
                typeof selectedWidget?.chartOptions?.sourceNote === 'string'
                  ? selectedWidget.chartOptions.sourceNote
                  : chartSource(selectedWidget?.chartOptions)
              }
              onChange={(patch) =>
                updateWidgetRoot(
                  'chartOptions',
                  'sourceNote' in patch
                    ? sourcePatch(selectedWidget?.chartOptions, patch.sourceNote)
                    : { ...(selectedWidget?.chartOptions || {}), ...patch },
                )
              }
            />
          ) : null}
        </>
      )}
    </div>
  );

  // ── Format tab ───────────────────────────────────────────────────────────────
  const formatTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">{tDash('select_widget_prompt')}</div>
      ) : isSlicer ? (
        <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12, padding: 8 }}>
          {tDash('slicer_format_unavailable')}
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
          {/* Format reads top to bottom: preset, style, colors, labels, axes, analytics. */}
          <ChartDesignControls
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
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
            mode="customize"
            sqlBound={sqlBound}
            isDesigner={isDesigner}
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
          <ChartTextFields
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            isDesigner={isDesigner}
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
          />
          <ChartNotesFields
            chartType={selectedWidget.chartType || 'bar'}
            chartData={(selectedWidget as { chartData?: { x?: unknown[] } }).chartData}
            annotations={(selectedWidget.chartOptions?.annotations as never[]) || []}
            onChange={(next) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), annotations: next })
            }
          />
          <ChartAnalytics
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            orderedAxis={orderedXAxis}
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
          />
        </>
      )}
      {hasWidget && !isDesigner ? (
        // Phones stack cards one per row; the author decides what earns a place there.
        <CheckboxField
          label={tDash('hide_on_phones')}
          hint={tDash('hide_on_phones_hint')}
          checked={(selectedWidget.chartOptions as { hideOnMobile?: boolean } | undefined)?.hideOnMobile === true}
          onChange={(v) => updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), hideOnMobile: v || undefined })}
        />
      ) : null}
    </div>
  );

  // ── Filters tab ──────────────────────────────────────────────────────────
  const allFilters = [...globalFiltersConfig, ...pageFiltersConfig];

  const filtersTab = (
    <div className="properties-panel-body">
      {/* Page-level Filters — dashboard studio only */}
      {!isDesigner && (
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
      )}

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
      {hasWidget && !isSlicer && !isContentBlock ? (
        <ChartSpecificFields
          chartType={selectedWidget.chartType || 'bar'}
          chartQuery={selectedWidget.chartQuery || {}}
          selectedWidget={selectedWidget}
          selectedTableColumns={selectedTableColumns || []}
          onUpdateChartQuery={updateChartQuery}
          chartOptions={selectedWidget.chartOptions || {}}
          mode="interact"
          dashboardPages={dashboardPages}
          sqlBound={sqlBound}
        />
      ) : null}
    </div>
  );

  // ── (Sort lives in Build, click behaviour in Filters) ─────────────────────────

  return (
    <aside
      className={`properties-panel${isCollapsed ? ' collapsed' : ''}`}
      aria-label={isCollapsed ? undefined : 'Widget properties'}
      aria-hidden={isCollapsed}
    >
      {!isCollapsed ? (
        <>
          {hasWidget ? (
            <ChartInlineEditor
              widgetId={selectedWidgetId}
              chartType={selectedWidget?.chartType}
              chartData={(selectedWidget as { chartData?: { x?: unknown[] } })?.chartData}
              chartOptions={selectedWidget?.chartOptions || {}}
              onPatch={(patch) =>
                updateWidgetRoot('chartOptions', { ...(selectedWidget?.chartOptions || {}), ...patch })
              }
            />
          ) : null}
          <div className="properties-panel-header">
            <span className="properties-panel-header-label">{tDash('properties_heading')}</span>
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
            ]}
          />
          <div className="properties-panel-footer">
            {/* Edits apply by themselves; this only re-runs the query (Datawrapper / Canva have
                no apply step, so a big primary button here read as "nothing saved until pressed"). */}
            <Tooltip title={tDash('reload_data_tip')}>
              <Button
                block
                size="small"
                icon={<ReloadOutlined />}
                disabled={!hasWidget || applyLoading}
                loading={applyLoading}
                onClick={handleApply}
              >
                {tDash('refresh_chart')}
              </Button>
            </Tooltip>
            {hasWidget && (
              <Button
                type="link"
                danger
                block
                size="small"
                onClick={() => {
                  const widgetTitle = selectedWidget?.title || tDash(deleteLabelKey);
                  Modal.confirm({
                    title: tDash('delete_widget_confirm_title'),
                    content: tDash('delete_widget_confirm_body', { title: widgetTitle }),
                    okButtonProps: { danger: true },
                    okText: tDash(deleteLabelKey),
                    onOk: () => removeWidget(selectedWidgetId!),
                  });
                }}
              >
                {tDash(deleteLabelKey)}
              </Button>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
};
