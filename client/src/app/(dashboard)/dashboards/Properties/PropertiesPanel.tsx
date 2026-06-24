'use client';

import React, { useState, useCallback } from 'react';
import { useWidgetProperties } from '../hooks/useWidgetProperties';
import { TextInputField, SelectField, CheckboxField, SectionLabel } from './FormFields';
import { ChartSpecificFields } from './ChartSpecificFields';
import { ChartOptions } from './ChartOptions';
import { Alert, Tabs, Collapse, ColorPicker, Button, Divider, Radio, Select, message, Table, Spin } from 'antd';
import { fetchApi } from '@/utils/api';
import {
  RightOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  FontColorsOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CloseOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

/** Compact data-preview panel shown in chart designer mode only. */
const DataPreviewPanel: React.FC<{
  dataSourceId?: string;
  tableName?: string;
}> = ({ dataSourceId, tableName }) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!dataSourceId || !tableName) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi('data/query/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `SELECT * FROM "${tableName.replace(/"/g, '""')}" LIMIT 5`,
          data_source_id: dataSourceId,
          optimization: false,
        }),
      });
      setRows(Array.isArray(result.data) ? result.data.slice(0, 5) : []);
      setShown(true);
    } catch (e: any) {
      setError(String(e?.message || 'Preview failed'));
    } finally {
      setLoading(false);
    }
  }, [dataSourceId, tableName]);

  if (!dataSourceId || !tableName) return null;

  const columns = rows.length > 0
    ? Object.keys(rows[0]).slice(0, 8).map((k) => ({
        title: k,
        dataIndex: k,
        key: k,
        ellipsis: true,
        width: 90,
        render: (v: unknown) => v == null ? <span style={{ color: '#8c8c8c' }}>null</span> : String(v),
      }))
    : [];

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <Button
        size="small"
        icon={<EyeOutlined />}
        loading={loading}
        onClick={shown ? () => setShown(false) : loadPreview}
        style={{ fontSize: 12 }}
      >
        {shown ? 'Hide preview' : 'Preview data'}
      </Button>
      {error && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{error}</div>}
      {shown && rows.length > 0 && (
        <div style={{ marginTop: 8, overflow: 'auto', maxHeight: 180, fontSize: 11 }}>
          <Table
            size="small"
            dataSource={rows.map((r, i) => ({ ...r, _key: i }))}
            columns={columns}
            rowKey="_key"
            pagination={false}
            scroll={{ x: true }}
            style={{ minWidth: 200 }}
          />
        </div>
      )}
      {shown && rows.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>No rows returned.</div>
      )}
    </div>
  );
};
import {
  CHART_TYPE_CONFIGS,
} from './PropertiesPanelConfig';
import './PropertiesPanel.css';
import { useTranslations } from 'next-intl';
import { PropertiesSetupSteps } from './PropertiesSetupSteps';
import { WidgetInspectorHeader } from '../components/WidgetInspectorHeader';
import { StatKpiFields } from './StatKpiFields';
import { preserveChartQueryOnTypeChange } from '../utils/chartTypeMappingPreserve';
import SavedQueryPicker from './SavedQueryPicker';
import { RelatedJoinsPicker, type JoinSpec } from './RelatedJoinsPicker';
import { SemanticMetricFields } from './SemanticMetricFields';
import { createAlertFromChart } from '@/services/chartAlertService';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { buildChartSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import { buildWidgetAlertSql } from '../utils/buildWidgetAlertSql';
import { useProjectStore } from '@/stores/useProjectStore';
import { isSlicerFieldConflicted } from '../utils/filterConflicts';
import type { FilterFieldConflict } from '../utils/filterConflicts';
import { chartService } from '../services/chartService';

interface PropertiesPanelProps {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  removeWidget: (id: string) => void;
  isCollapsed: boolean;
  isDesigner?: boolean;
  dashboardPages?: { id: string; name: string }[];
  activeDashboardId?: string | null;
  peerEditingWidgetId?: string | null;
  currentProjectId?: string | number | null;
  filterFieldConflicts?: FilterFieldConflict[];
  activeDashboardIdForFilters?: string | null;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedWidget,
  selectedWidgetId,
  widgets,
  setWidgets,
  isCollapsed,
  removeWidget,
  isDesigner = false,
  dashboardPages = [],
  activeDashboardId,
  peerEditingWidgetId,
  currentProjectId: currentProjectIdProp,
  filterFieldConflicts = [],
  activeDashboardIdForFilters,
}) => {
  const t = useTranslations('properties_panel');
  const td = useTranslations('dashboards');
  const storeProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentProjectId = currentProjectIdProp ?? storeProjectId;
  const publishOrganizationId =
    currentProject?.organization_id ||
    (currentProject as { organizationId?: string } | null)?.organizationId ||
    undefined;
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [publishChartOpen, setPublishChartOpen] = useState(false);
  const [setupFocus, setSetupFocus] = useState<string[]>(['fields']);
  const {
    dataSources,
    selectedTableColumns,
    availableTables,
    updateWidgetRoot,
    updateChartQuery,
    handleDataSourceChange,
    isLoading,
    schemaLoading,
  } = useWidgetProperties({ selectedWidget, selectedWidgetId, widgets, setWidgets, isDesigner });

  const chartType = selectedWidget?.chartType || 'bar';
  const chartOptions = selectedWidget?.chartOptions || {};
  const isSlicer = chartType === 'slicer';
  const slicerField = selectedWidget?.chartQuery?.field || selectedWidget?.chartQuery?.x;
  const slicerConflict = isSlicerFieldConflicted(slicerField, filterFieldConflicts);
  const [detectingSlicerBounds, setDetectingSlicerBounds] = useState(false);

  const handleDetectSlicerBounds = async () => {
    if (!activeDashboardIdForFilters || !slicerField || !selectedWidget?.dataSourceId) return;
    setDetectingSlicerBounds(true);
    try {
      const stats = await chartService.getFilterFieldStats(
        activeDashboardIdForFilters,
        String(slicerField),
        String(selectedWidget.dataSourceId),
        { tableName: selectedWidget.chartQuery?.tableName },
      );
      if (stats.min != null && stats.max != null) {
        const min = stats.min === stats.max ? stats.min - 1 : stats.min;
        const max = stats.min === stats.max ? stats.max + 1 : stats.max;
        updateChartQuery('numericMin', min);
        updateChartQuery('numericMax', max);
      }
    } finally {
      setDetectingSlicerBounds(false);
    }
  };

  const updateChartOption = (key: string, value: any) => {
    // Global block text size should affect all major chart text controls.
    if (key === 'axisLabelFontSize') {
      updateWidgetRoot('chartOptions', {
        ...chartOptions,
        axisLabelFontSize: value,
        hAxisFontSize: value,
        vAxisFontSize: value,
        legendFontSize: value,
      });
      return;
    }

    updateWidgetRoot('chartOptions', { ...chartOptions, [key]: value });
  };

  const updateChartOptions = (updates: Record<string, any>) => {
    updateWidgetRoot('chartOptions', { ...chartOptions, ...updates });
  };

  const showSidebar = !!selectedWidgetId && !!selectedWidget;
  const isText = chartType === 'text';
  const isStat = chartType === 'stat';
  const isDivider = chartType === 'divider';
  const isImage = chartType === 'image';
  const isGauge = chartType === 'gauge';
  const showSetupSteps = !isText && !isDivider && !isImage;

  const focusSetupSection = (section: 'dataSource' | 'table' | 'fields' | 'style') => {
    document.getElementById(`prop-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleChartTypeChange = (val: string) => {
    if (!selectedWidget) return;
    const nextQuery = preserveChartQueryOnTypeChange(selectedWidget, val);
    setWidgets(
      widgets.map((w) =>
        w.id === selectedWidgetId ? { ...w, chartType: val, chartQuery: nextQuery } : w,
      ),
    );
  };

  const handleMonitorKpi = async () => {
    if (!selectedWidget) return;
    const sql = buildWidgetAlertSql(selectedWidget);
    if (!sql) {
      message.warning(td('monitor_kpi_no_sql'));
      return;
    }
    setMonitorLoading(true);
    try {
      await createAlertFromChart({
        title: selectedWidget.title || td('metric_widget'),
        sqlQuery: sql,
        dataSourceId: selectedWidget.dataSourceId ?? null,
        projectId: currentProjectId != null ? String(currentProjectId) : null,
      });
      message.success(td('monitor_kpi_success'));
    } catch (err) {
      console.error('[PropertiesPanel] monitor KPI', err);
      message.error(String(err instanceof Error ? err.message : err));
    } finally {
      setMonitorLoading(false);
    }
  };

  const generalTabItems = isSlicer ? (
    <>
      <PropertiesSetupSteps
        widget={selectedWidget}
        onFocusSection={(section) => {
          document.getElementById(`prop-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
      />
      <div id="prop-section-dataSource">
        <SelectField
          label={td('data_source')}
          required
          value={selectedWidget?.dataSourceId || undefined}
          onChange={handleDataSourceChange}
          options={dataSources.map((ds: { id: string; name: string }) => ({ label: ds.name, value: ds.id }))}
          placeholder={isLoading ? t('loading') : td('data_source')}
          isLoading={isLoading}
          showSearch
        />
      </div>
      {availableTables && availableTables.length > 0 && (
        <div id="prop-section-table">
          <SelectField
            label={td('table')}
            value={selectedWidget?.chartQuery?.tableName || undefined}
            onChange={(v) => updateChartQuery('tableName', v)}
            options={availableTables.map((tbl: string) => ({ label: tbl, value: tbl }))}
            showSearch
          />
        </div>
      )}
      <div id="prop-section-fields">
        <SelectField
          label={td('slicer_filter_field')}
          required
          value={selectedWidget?.chartQuery?.field || selectedWidget?.chartQuery?.x || undefined}
          onChange={(v) => {
            updateChartQuery('field', v);
            updateChartQuery('x', v);
          }}
          options={selectedTableColumns}
          placeholder={td('slicer_pick_field')}
          isLoading={schemaLoading}
          showSearch
        />
        <SelectField
          label={td('slicer_mode')}
          value={selectedWidget?.chartQuery?.mode || 'single'}
          onChange={(v) => updateChartQuery('mode', v)}
          options={[
            { label: td('slicer_mode_single'), value: 'single' },
            { label: td('slicer_mode_multi'), value: 'multi' },
            { label: td('slicer_mode_tile'), value: 'tile' },
            { label: td('slicer_mode_toggle'), value: 'toggle' },
            { label: td('slicer_mode_date'), value: 'date' },
            { label: td('slicer_mode_daterange'), value: 'dateRange' },
            { label: td('slicer_mode_numeric'), value: 'numericRange' },
          ]}
        />
        {selectedWidget?.chartQuery?.mode === 'numericRange' && (
          <>
            <TextInputField
              label={td('filter_slider_min')}
              value={String(selectedWidget?.chartQuery?.numericMin ?? '')}
              onChange={(v) => updateChartQuery('numericMin', v === '' ? undefined : Number(v))}
              placeholder={td('filter_slider_auto_hint')}
            />
            <TextInputField
              label={td('filter_slider_max')}
              value={String(selectedWidget?.chartQuery?.numericMax ?? '')}
              onChange={(v) => updateChartQuery('numericMax', v === '' ? undefined : Number(v))}
              placeholder={td('filter_slider_auto_hint')}
            />
            {activeDashboardIdForFilters && slicerField && selectedWidget?.dataSourceId ? (
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={detectingSlicerBounds}
                onClick={() => void handleDetectSlicerBounds()}
                style={{ marginBottom: 12 }}
              >
                {td('filter_detect_bounds')}
              </Button>
            ) : null}
          </>
        )}
        {/* Cascading filter dependency — only for dropdown/tile/toggle modes */}
        {['single', 'multi', 'tile', 'toggle'].includes(selectedWidget?.chartQuery?.mode || 'single') && (() => {
          const otherSlicerFields = (widgets || [])
            .filter((w) => w.chartType === 'slicer' && w.id !== selectedWidgetId)
            .map((w) => {
              const f = w.chartQuery?.field || w.chartQuery?.x || '';
              const lbl = f || w.title || w.id;
              return { label: lbl, value: f };
            })
            .filter((o) => o.value);
          if (otherSlicerFields.length === 0) return null;
          return (
            <SelectField
              label={td('slicer_cascade_from')}
              value={selectedWidget?.chartQuery?.cascadeFromField || undefined}
              onChange={(v) => updateChartQuery('cascadeFromField', v || undefined)}
              options={[
                { label: td('slicer_cascade_none'), value: '' },
                ...otherSlicerFields,
              ]}
              placeholder={td('slicer_cascade_none')}
            />
          );
        })()}
        <TextInputField
          label={td('slicer_display_label')}
          value={(chartOptions as { slicerLabel?: string }).slicerLabel || selectedWidget?.title || ''}
          onChange={(value) => updateChartOption('slicerLabel', value)}
        />
      </div>
    </>
  ) : null;

  const items = [
    {
      key: 'general',
      label: t('tab_quick'),
      children: (
        <div className="tab-pane-content">
      {isSlicer && (
        <>
          {slicerConflict ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={td('filter_conflict_title')}
              description={td('filter_conflict_slicer_field', { field: slicerConflict.field })}
            />
          ) : null}
          <TextInputField
            label={t('title')}
            value={selectedWidget?.title || ''}
            onChange={(value) => updateWidgetRoot('title', value)}
            placeholder={td('slicer_widget')}
          />
          {generalTabItems}
        </>
      )}

      {/* Image widget properties */}
      {isImage && (
        <>
          <TextInputField
            label={t('image_url')}
            value={chartOptions.imageUrl || chartOptions.src || ''}
            onChange={(v) => updateChartOption('imageUrl', v)}
            placeholder={t('image_url_placeholder')}
          />
          <TextInputField
            label={t('image_alt_text')}
            value={chartOptions.altText || ''}
            onChange={(v) => updateChartOption('altText', v)}
          />
          <SelectField
            label={t('image_object_fit')}
            value={chartOptions.objectFit || 'contain'}
            onChange={(v) => updateChartOption('objectFit', v)}
            options={[
              { label: t('object_fit_contain'), value: 'contain' },
              { label: t('object_fit_cover'), value: 'cover' },
              { label: t('object_fit_fill'), value: 'fill' },
              { label: t('object_fit_none'), value: 'none' },
            ]}
          />
        </>
      )}

      {/* Section Divider properties */}
      {isDivider && (
        <>
          <TextInputField
            label={t('section_title')}
            value={chartOptions.sectionTitle || ''}
            onChange={(v) => updateChartOption('sectionTitle', v)}
            placeholder={t('section_title_placeholder')}
          />
          <CheckboxField
            label={t('section_title_uppercase')}
            checked={chartOptions.uppercase === true}
            onChange={(v) => updateChartOption('uppercase', v)}
          />
          <CheckboxField
            label={t('section_hide_line')}
            checked={chartOptions.hideLine === true}
            onChange={(v) => updateChartOption('hideLine', v)}
          />
        </>
      )}

      {/* Gauge extra config */}
      {isGauge && (
        <>
          <TextInputField
            label={t('gauge_min')}
            value={String(chartOptions.gaugeMin ?? 0)}
            onChange={(v) => updateChartOption('gaugeMin', Number(v))}
          />
          <TextInputField
            label={t('gauge_max')}
            value={String(chartOptions.gaugeMax ?? 100)}
            onChange={(v) => updateChartOption('gaugeMax', Number(v))}
          />
          <TextInputField
            label={t('gauge_target')}
            value={chartOptions.gaugeTarget !== undefined ? String(chartOptions.gaugeTarget) : ''}
            onChange={(v) => updateChartOption('gaugeTarget', v ? Number(v) : undefined)}
            placeholder={t('gauge_target_placeholder')}
          />
          <TextInputField
            label={t('stat_unit')}
            value={chartOptions.gaugeUnit || ''}
            onChange={(v) => updateChartOption('gaugeUnit', v)}
            placeholder="%, $, ms"
          />
          <TextInputField
            label={t('gauge_label')}
            value={chartOptions.gaugeLabel || ''}
            onChange={(v) => updateChartOption('gaugeLabel', v)}
          />
        </>
      )}

      {!isSlicer && !isDivider && !isImage && (
        <>
          <TextInputField
            label={t('title')}
            value={selectedWidget?.title || ''}
            onChange={(value) => updateWidgetRoot('title', value)}
            placeholder={t('widget_title_placeholder')}
          />
          <TextInputField
            label={t('subtitle')}
            value={chartOptions.subtitle || ''}
            onChange={(v) => updateChartOption('subtitle', v)}
            placeholder={t('subtitle_placeholder')}
          />
        </>
      )}

          {!isText && !isSlicer && !isDivider && !isImage && (
            <>
              {showSetupSteps ? (
                <PropertiesSetupSteps widget={selectedWidget} onFocusSection={focusSetupSection} />
              ) : null}
              <div id="prop-section-dataSource">
              <SelectField
                label={t('data_source')}
                required={true}
                value={selectedWidget?.dataSourceId || undefined}
                onChange={handleDataSourceChange}
                options={dataSources.map((ds: any) => ({ label: ds.name, value: ds.id }))}
                placeholder={
                  isLoading
                    ? t('loading_data_sources')
                    : dataSources.length === 0
                      ? t('no_data_sources_available')
                      : t('choose_data_source')
                }
                disabled={false}
                isLoading={isLoading}
                showSearch={true}
              />
              </div>

              {availableTables &&
                availableTables.length > 0 &&
                !(availableTables.length === 1 && availableTables[0] === 'data') && (
                  <>
                    <div id="prop-section-table">
                    <SelectField
                      label={t('table')}
                      required={true}
                      value={selectedWidget?.chartQuery?.tableName || availableTables[0]}
                      onChange={(value) => updateChartQuery('tableName', value)}
                      options={availableTables.map((t: string) => ({ label: t, value: t }))}
                      placeholder={t('choose_table_placeholder')}
                      isLoading={schemaLoading}
                      showSearch={true}
                    />
                    </div>

                    <SavedQueryPicker
                      value={selectedWidget?.chartQuery?.saved_query_id as string | undefined}
                      onChange={(id) => updateChartQuery('saved_query_id', id)}
                    />
                    {selectedWidget?.chartQuery?.saved_query_id ? (
                      <Alert
                        type="info"
                        showIcon
                        message={t('saved_query_active_title')}
                        description={t('saved_query_active_desc')}
                        style={{ marginBottom: 8 }}
                      />
                    ) : null}

                    {!selectedWidget?.chartQuery?.saved_query_id && (
                      <>
                    <RelatedJoinsPicker
                      dataSourceId={selectedWidget?.dataSourceId}
                      joins={(selectedWidget?.chartQuery?.joins as JoinSpec[]) || []}
                      onChange={(joins) => updateChartQuery('joins', joins)}
                    />

                    <SemanticMetricFields
                      dataSourceId={selectedWidget?.dataSourceId}
                      chartQuery={selectedWidget?.chartQuery || {}}
                      onChange={(updates) => {
                        Object.entries(updates).forEach(([key, value]) => updateChartQuery(key, value));
                      }}
                      recommendWhenAvailable
                    />
                      </>
                    )}
                  </>
                )}

              {/* Show helper message when no data sources are available */}
              {!isLoading && dataSources.length === 0 && (
                <Alert
                  message={t('no_data_sources')}
                  description={t('no_data_sources_desc')}
                  type="info"
                  showIcon
                  style={{ marginTop: 8, marginBottom: 16 }}
                />
              )}

              <SelectField
                label={t('chart_type')}
                value={chartType}
                onChange={handleChartTypeChange}
                options={Object.entries(CHART_TYPE_CONFIGS).map(([val, cfg]) => ({
                  label: cfg.label,
                  value: val,
                }))}
              />

              {isStat ? (
                <StatKpiFields chartOptions={chartOptions} onUpdate={updateChartOption} />
              ) : null}

              {/* Data preview — chart designer only */}
              {isDesigner && selectedWidget?.dataSourceId && selectedWidget?.chartQuery?.tableName && (
                <DataPreviewPanel
                  dataSourceId={selectedWidget.dataSourceId}
                  tableName={selectedWidget.chartQuery.tableName}
                />
              )}

              <div className="panel-divider" style={{ margin: '16px 0' }} />

              <div id="prop-section-fields">
              <ChartSpecificFields
                mode="mapping"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />
              </div>

              <div className="panel-divider" style={{ margin: '16px 0' }} />

              <div id="prop-section-style">
              <ChartSpecificFields
                mode="colors"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />

              <ChartOptions
                chartType={chartType}
                chartOptions={chartOptions}
                chartQuery={selectedWidget?.chartQuery || {}}
                onUpdateChartOption={updateChartOption}
              />
              </div>
            </>
          )}

          {/* Delete Button for all widgets including text */}
          <Divider style={{ margin: '16px 0' }} />
          <Button
            danger
            block
            onClick={() => removeWidget(selectedWidgetId!)}
            style={{ marginTop: 8 }}
          >
            {t('delete_widget')}
          </Button>
        </div>
      ),
    },
    {
      key: 'customize',
      label: t('tab_design'),
      children: (
        <div className="tab-pane-content" style={{ padding: 0 }}>
          {!isText && (
            <div style={{ padding: '0 16px' }}>
              <ChartSpecificFields
                mode="customize"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />
            </div>
          )}

          <Collapse
            ghost
            expandIconPosition="end"
            expandIcon={({ isActive }) => (
              <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: '10px', color: '#8c8c8c' }} />
            )}
            className="styling-collapse"
            items={[
              {
                key: 'background',
                label: <span className="collapse-label">{t('background_and_title')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('background_color')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.backgroundColor || '#ffffff'}
                        onChange={(color) => updateChartOption('backgroundColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('backgroundColor', 'transparent')}
                                style={{ marginBottom: 8 }}
                              >
                                {t('transparent')}
                              </Button>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('backgroundColor', undefined)}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset_to_default')}
                              </Button>
                            </div>
                            <Divider style={{ margin: 0 }} />
                            <div className="color-picker-panel-custom">{panel}</div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              className="color-preview-box"
                              style={{ 
                                backgroundColor: chartOptions.backgroundColor === 'transparent' ? 'transparent' : (chartOptions.backgroundColor || '#ffffff'),
                                border: chartOptions.backgroundColor === 'transparent' ? '1px dashed #d9d9d9' : '1px solid #f0f0f0'
                              }}
                            />
                            <span className="color-hex-text">
                              {chartOptions.backgroundColor === 'transparent' ? t('transparent_upper') : (chartOptions.backgroundColor || '#ffffff').toUpperCase()}
                            </span>
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">Border</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Select
                          size="small"
                          popupClassName="properties-panel-dropdown"
                          value={chartOptions.borderWidth ?? 0}
                          onChange={(v) => updateChartOption('borderWidth', v)}
                          style={{ width: 72 }}
                          options={[0, 1, 2, 3, 4].map((n) => ({ label: `${n}px`, value: n }))}
                        />
                        <ColorPicker
                          size="small"
                          value={chartOptions.borderColor || '#d9d9d9'}
                          onChange={(color) => updateChartOption('borderColor', color.toHexString())}
                          disabled={!chartOptions.borderWidth}
                          trigger="click"
                          placement="bottomRight"
                        >
                          <div
                            className="color-picker-trigger-select"
                            style={{ flex: 1, opacity: chartOptions.borderWidth ? 1 : 0.4 }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div
                                className="color-preview-box"
                                style={{ backgroundColor: chartOptions.borderColor || '#d9d9d9' }}
                              />
                              <span className="color-hex-text">
                                {(chartOptions.borderColor || '#D9D9D9').toUpperCase()}
                              </span>
                            </div>
                            <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                          </div>
                        </ColorPicker>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">Box Shadow</span>
                      <Select
                        size="small"
                        popupClassName="properties-panel-dropdown"
                        value={chartOptions.boxShadow || 'none'}
                        onChange={(v) => updateChartOption('boxShadow', v === 'none' ? undefined : v)}
                        options={[
                          { label: 'None', value: 'none' },
                          { label: 'Small', value: 'sm' },
                          { label: 'Medium', value: 'md' },
                          { label: 'Large', value: 'lg' },
                        ]}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('title_style')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.titleColor || '#24292f'}
                        onChange={(color) => updateChartOption('titleColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => {
                                  updateChartOptions({
                                    titleColor: undefined,
                                    titleFontWeight: 'normal',
                                  });
                                }}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset')}
                              </Button>

                              <div style={{ marginBottom: 8, fontSize: 12, color: '#646a73' }}>{t('text_color')}</div>
                              <div className="color-picker-panel-custom">{panel}</div>

                              <div style={{ marginTop: 10 }}>
                                <div style={{ marginBottom: 8, fontSize: 12, color: '#646a73' }}>{t('text_weight')}</div>
                                <Radio.Group
                                  size="small"
                                  value={chartOptions.titleFontWeight || 'normal'}
                                  onChange={(e) => updateChartOption('titleFontWeight', e.target.value)}
                                >
                                  <Radio value="normal">{t('default')}</Radio>
                                  <Radio value="bold">{t('bold')}</Radio>
                                </Radio.Group>
                              </div>
                            </div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              className="color-preview-box"
                              style={{ backgroundColor: chartOptions.titleColor || '#24292f' }}
                            />
                            <span className="color-hex-text">
                              {(chartOptions.titleColor || '#24292F').toUpperCase()}
                            </span>
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>
                  </div>
                ),
              },
              {
                key: 'block-text',
                label: <span className="collapse-label">{t('block_text_style')}</span>,
                children: (
                  <div className="collapse-content-inner" style={{ gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('font_color')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.axisLabelColor === 'default' ? undefined : chartOptions.axisLabelColor}
                        onChange={(color) => updateChartOption('axisLabelColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('axisLabelColor', 'default')}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset')}
                              </Button>
                            </div>
                            <Divider style={{ margin: 0 }} />
                            <div className="color-picker-panel-custom">{panel}</div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {!chartOptions.axisLabelColor || chartOptions.axisLabelColor === 'default' ? (
                              <span className="color-hex-text">{t('default')}</span>
                            ) : (
                              <>
                                <div
                                  className="color-preview-box"
                                  style={{ backgroundColor: chartOptions.axisLabelColor }}
                                />
                                <span className="color-hex-text">{chartOptions.axisLabelColor.toUpperCase()}</span>
                              </>
                            )}
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>

                    <SelectField
                      label={t('font_size')}
                      value={chartOptions.axisLabelFontSize || 11}
                      onChange={(val) => updateChartOption('axisLabelFontSize', val)}
                      options={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36].map((s) => ({
                        label: `${s}`,
                        value: s,
                      }))}
                      showSearch={false}
                    />
                  </div>
                ),
              },
              {
                key: 'axis-title',
                label: <span className="collapse-label">{t('axis_title')}</span>,
                children: (
                  <div className="collapse-content-inner" style={{ gap: 12 }}>
                    <TextInputField
                      label={t('x_axis_title')}
                      value={chartOptions.xAxisLabel ?? selectedWidget?.chartData?.xMetrics?.[0]?.name ?? ''}
                      onChange={(val) => updateChartOption('xAxisLabel', val)}
                      placeholder={t('x_axis_title_placeholder')}
                    />

                    <TextInputField
                      label={selectedWidget?.chartQuery?.yMetricsSecondary?.length > 0 ? t('left_y_axis_title') : t('y_axis_title')}
                      value={chartOptions.yAxisLabel ?? selectedWidget?.chartData?.series?.[0]?.name ?? ''}
                      onChange={(val) => updateChartOption('yAxisLabel', val)}
                      placeholder={t('y_axis_title_placeholder')}
                    />

                    {selectedWidget?.chartQuery?.yMetricsSecondary?.length > 0 && (
                      <TextInputField
                        label={t('right_y_axis_title')}
                        value={chartOptions.yAxisSecondaryLabel ?? selectedWidget?.chartData?.secondarySeries?.[0]?.name ?? ''}
                        onChange={(val) => updateChartOption('yAxisSecondaryLabel', val)}
                        placeholder={t('secondary_y_axis_title_placeholder')}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: 'legend',
                label: <span className="collapse-label">{t('legend')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <CheckboxField
                        label="Show legend"
                        checked={chartOptions.showLegend !== false}
                        onChange={(val) => updateChartOption('showLegend', val)}
                      />
                      
                      <SelectField
                        label="Legend position"
                        value={chartOptions.legendPosition || 'top'}
                        onChange={(val) => updateChartOption('legendPosition', val)}
                        disabled={chartOptions.showLegend === false}
                        options={[
                          { label: t('position_top'), value: 'top' },
                          { label: t('position_bottom'), value: 'bottom' },
                          { label: t('position_left'), value: 'left' },
                          { label: t('position_right'), value: 'right' },
                          { label: t('hide'), value: 'hide' },
                        ]}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: 'vertical-axis',
                label: <span className="collapse-label">{t('vertical_axis')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <CheckboxField
                      label={t('show_labels')}
                      checked={chartOptions.showVAxisLabels !== false}
                      onChange={(val) => updateChartOption('showVAxisLabels', val)}
                    />

                    {chartOptions.showVAxisLabels !== false && (
                      <div className="axis-inner-panel">
                        <SelectField
                          label={t('slant_labels')}
                          value={chartOptions.vAxisLabelSlant || 'none'}
                          onChange={(val) => updateChartOption('vAxisLabelSlant', val)}
                          options={[
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowUpOutlined />
                                  </div>
                                  {t('slant_rotate_up')}
                                </div>
                              ),
                              value: 'up',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(-45deg)' }} />
                                  </div>
                                  {t('slant_left_diagonal')}
                                </div>
                              ),
                              value: 'left-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined />
                                  </div>
                                  {t('slant_horizontal')}
                                </div>
                              ),
                              value: 'none',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(45deg)' }} />
                                  </div>
                                  {t('slant_right_diagonal')}
                                </div>
                              ),
                              value: 'right-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowDownOutlined />
                                  </div>
                                  {t('slant_rotate_down')}
                                </div>
                              ),
                              value: 'down',
                            },
                          ]}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="field-label-sm">{t('title_format')}</span>
                          <div className="format-toolbar">
                            <Select
                              size="small"
                              variant="borderless"
                              popupClassName="properties-panel-dropdown"
                              value={chartOptions.vAxisFontSize || 10}
                              onChange={(val) => updateChartOption('vAxisFontSize', val)}
                              style={{ flex: 1 }}
                              suffixIcon={<RightOutlined rotate={90} style={{ fontSize: 8 }} />}
                              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => ({ label: `${s}`, value: s }))}
                            />
                            <div className="format-toolbar-divider" />
                            <div style={{ flex: 1, display: 'flex' }}>
                              <ColorPicker
                                size="small"
                                value={chartOptions.vAxisColor || '#3c4043'}
                                onChange={(color) => updateChartOption('vAxisColor', color.toHexString())}
                                trigger="click"
                                placement="bottomRight"
                                style={{ flex: 1 }}
                              >
                                <div className="format-toolbar-item">
                                  <FontColorsOutlined style={{ color: chartOptions.vAxisColor || '#3c4043' }} />
                                </div>
                              </ColorPicker>
                            </div>
                            <div className="format-toolbar-divider" />
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisBold ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisBold', !chartOptions.vAxisBold)}
                            >
                              <BoldOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisItalic ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisItalic', !chartOptions.vAxisItalic)}
                            >
                              <ItalicOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisStrikethrough ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisStrikethrough', !chartOptions.vAxisStrikethrough)}
                            >
                              <StrikethroughOutlined style={{ fontSize: 12 }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      <CheckboxField
                        label={t('show_axis_line')}
                        checked={chartOptions.showVAxisLine !== false}
                        onChange={(val) => updateChartOption('showVAxisLine', val)}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: 'horizontal-axis',
                label: <span className="collapse-label">{t('horizontal_axis')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <CheckboxField
                      label={t('show_labels')}
                      checked={chartOptions.showHAxisLabels !== false}
                      onChange={(val) => updateChartOption('showHAxisLabels', val)}
                    />

                    {chartOptions.showHAxisLabels !== false && (
                      <div className="axis-inner-panel">
                        <SelectField
                          label={t('slant_labels')}
                          value={chartOptions.hAxisLabelSlant || 'none'}
                          onChange={(val) => updateChartOption('hAxisLabelSlant', val)}
                          options={[
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowUpOutlined />
                                  </div>
                                  {t('slant_rotate_up')}
                                </div>
                              ),
                              value: 'up',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(-45deg)' }} />
                                  </div>
                                  {t('slant_left_diagonal')}
                                </div>
                              ),
                              value: 'left-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined />
                                  </div>
                                  {t('slant_horizontal')}
                                </div>
                              ),
                              value: 'none',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(45deg)' }} />
                                  </div>
                                  {t('slant_right_diagonal')}
                                </div>
                              ),
                              value: 'right-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowDownOutlined />
                                  </div>
                                  {t('slant_rotate_down')}
                                </div>
                              ),
                              value: 'down',
                            },
                          ]}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="field-label-sm">{t('title_format')}</span>
                          <div className="format-toolbar">
                            <Select
                              size="small"
                              variant="borderless"
                              popupClassName="properties-panel-dropdown"
                              value={chartOptions.hAxisFontSize || 10}
                              onChange={(val) => updateChartOption('hAxisFontSize', val)}
                              style={{ flex: 1 }}
                              suffixIcon={<RightOutlined rotate={90} style={{ fontSize: 8 }} />}
                              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => ({ label: `${s}`, value: s }))}
                            />
                            <div className="format-toolbar-divider" />
                            <div style={{ flex: 1, display: 'flex' }}>
                              <ColorPicker
                                size="small"
                                value={chartOptions.hAxisColor || '#3c4043'}
                                onChange={(color) => updateChartOption('hAxisColor', color.toHexString())}
                                trigger="click"
                                placement="bottomRight"
                                style={{ flex: 1 }}
                              >
                                <div className="format-toolbar-item">
                                  <FontColorsOutlined style={{ color: chartOptions.hAxisColor || '#3c4043' }} />
                                </div>
                              </ColorPicker>
                            </div>
                            <div className="format-toolbar-divider" />
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisBold ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisBold', !chartOptions.hAxisBold)}
                            >
                              <BoldOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisItalic ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisItalic', !chartOptions.hAxisItalic)}
                            >
                              <ItalicOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisStrikethrough ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisStrikethrough', !chartOptions.hAxisStrikethrough)}
                            >
                              <StrikethroughOutlined style={{ fontSize: 12 }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      <CheckboxField
                        label={t('show_axis_line')}
                        checked={chartOptions.showHAxisLine !== false}
                        onChange={(val) => updateChartOption('showHAxisLine', val)}
                      />
                    </div>
                  </div>
                ),
              },
            ].filter((item) => {
              if (chartType === 'pie' || chartType === 'donut') {
                return !['axis-title', 'vertical-axis', 'horizontal-axis'].includes(item.key);
              }
              return true;
            })}
          />
        </div>
      ),
    },
    {
      key: 'advanced',
      label: t('tab_advanced'),
      children: (
        <div className="tab-pane-content">
          {!isText && (
            <ChartSpecificFields
              mode="advanced"
              chartType={chartType}
              chartQuery={selectedWidget?.chartQuery || {}}
              selectedWidget={selectedWidget}
              selectedTableColumns={selectedTableColumns}
              isLoading={schemaLoading}
              onUpdateChartQuery={updateChartQuery}
              chartOptions={chartOptions}
              onUpdateChartOption={updateChartOption}
              onUpdateChartOptions={updateChartOptions}
              dashboardPages={dashboardPages}
            />
          )}
        </div>
      )
    }
  ].filter((item) => (isText || isSlicer || isDivider || isImage ? item.key === 'general' : true));

  return (
    <aside className={`properties-panel ${isCollapsed || !showSidebar ? 'collapsed' : ''}`}>
      <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <h3>{t('properties')}</h3>
      </div>

      {showSidebar ? (
        <WidgetInspectorHeader
          widget={selectedWidget}
          chartTypeLabel={CHART_TYPE_CONFIGS[chartType]?.label}
        />
      ) : null}

      {showSidebar && peerEditingWidgetId && peerEditingWidgetId === selectedWidgetId ? (
        <Alert type="info" showIcon message={td('peer_editing_widget')} style={{ margin: '8px 12px 0' }} />
      ) : showSidebar && selectedWidgetId ? (
        <Alert type="success" showIcon message={td('editing_widget_banner')} style={{ margin: '8px 12px 0' }} />
      ) : null}

      {showSidebar && selectedWidget?.chartId && selectedWidget?.chartType !== 'text' && !isDesigner && (
        <div style={{ padding: '8px 12px 0' }}>
          <Button block onClick={() => setPublishChartOpen(true)}>
            {td('publish_chart_to_feed')}
          </Button>
        </div>
      )}

      {showSidebar && isStat && (
        <div style={{ padding: '8px 12px 0' }}>
          <Button block loading={monitorLoading} onClick={() => void handleMonitorKpi()}>
            {td('monitor_kpi')}
          </Button>
        </div>
      )}

      {showSidebar && (
        <div className="panel-tabs-wrapper">
          <Tabs
            defaultActiveKey="general"
            items={items}
            className="properties-tabs"
            animated={{ inkBar: true, tabPane: false }}
          />
        </div>
      )}

      {selectedWidget?.chartId && (
        <PublishToFeedModal
          open={publishChartOpen}
          assetType="chart"
          assetId={String(selectedWidget.chartId)}
          defaultTitle={selectedWidget.title || td('untitled_chart')}
          previewMetadata={{
            previewType: selectedWidget.chartType,
            chartWidget: {
              chartType: selectedWidget.chartType,
              chartData: selectedWidget.chartData,
              chartOptions: selectedWidget.chartOptions,
              chartQuery: selectedWidget.chartQuery,
            },
          }}
          snapshotPayload={buildChartSnapshotPayload({
            title: selectedWidget.title || td('untitled_chart'),
            chartWidget: {
              chartType: selectedWidget.chartType,
              chartData: selectedWidget.chartData,
              chartOptions: selectedWidget.chartOptions,
              chartQuery: selectedWidget.chartQuery,
            },
            sourcePath: '/dashboards',
            chartId: String(selectedWidget.chartId),
          }) as unknown as Record<string, unknown>}
          renderMode="snapshot"
          projectId={currentProjectId != null ? String(currentProjectId) : undefined}
          organizationId={publishOrganizationId}
          captureSelector={`[data-widget-id="${selectedWidget.id}"]`}
          onCancel={() => setPublishChartOpen(false)}
          onSuccess={() => setPublishChartOpen(false)}
        />
      )}
    </aside>
  );
};
