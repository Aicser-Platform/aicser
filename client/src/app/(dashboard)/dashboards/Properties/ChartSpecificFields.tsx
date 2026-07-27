import React from 'react';
import { Divider, Alert, Button, Tooltip, Collapse, ColorPicker } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import {
  SelectField,
  ToggleField,
  SegmentedField,
  MetricListField,
  ColorPaletteField,
  ColorPickerField,
  FilterListField,
  MetricFilterListField,
  CheckboxField,
  InputField,
} from './FormFields';
import { PpLabel } from './PpLabel';
import {
  CHART_TYPE_CONFIGS,
  METRIC_OPTIONS,
  BAR_CHART_TYPE_SELECT_OPTIONS,
  BAR_STACK_MODE_OPTIONS,
  LINE_CHART_TYPE_OPTIONS,
  LINE_STACK_MODE_OPTIONS,
  AREA_STACK_MODE_OPTIONS,
} from './PropertiesPanelConfig';
import { useTranslations } from 'next-intl';
import { useDashboardStore } from '../stores/useDashboardStore';
import { WIDGET_PALETTE_INHERIT } from '../utils/chartPaletteCatalog';
import { ConditionalFormattingEditor } from './ConditionalFormattingEditor';
import type { ConditionalFormattingRule } from './ConditionalFormattingEditor';
import { TableColumnManager } from './TableColumnManager';
import type { DashboardFieldDragPayload } from '../utils/dashboardFieldDrag';
import { StatKpiFields } from './StatKpiFields';
import { COMPARISON_PERIOD_LABELS } from '../utils/timeIntelligence';
import { validateYMetrics } from '../utils/metricValidation';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';
import { IconPicker } from '../icons';

interface ChartFieldsProps {
  chartType: string;
  chartQuery: any;
  selectedWidget: any;
  selectedTableColumns: any[];
  isLoading?: boolean;
  onUpdateChartQuery: (key: string, value: any) => void;
  onDataSourceLoad?: () => void;
  chartOptions?: any;
  onUpdateChartOption?: (key: string, value: any) => void;
  onUpdateChartOptions?: (updates: Record<string, any>) => void;
  onFieldDrop?: (targetKey: string, field: DashboardFieldDragPayload) => void;
  mode?: 'mapping' | 'customize' | 'colors' | 'advanced' | 'filters';
  dashboardPages?: { id: string; name: string }[];
  fetchDistinctValues?: (field: string) => Promise<Array<{ label: string; value: string }>>;
  /** Saved / custom SQL card — new metrics default to Don't summarize */
  sqlBound?: boolean;
}

/**
 * Dynamically renders chart-specific fields based on chart type configuration
 * Reduces code duplication and makes adding new chart types easier
 */
export const ChartSpecificFields: React.FC<ChartFieldsProps> = ({
  chartType,
  chartQuery,
  selectedWidget,
  selectedTableColumns,
  isLoading = false,
  onUpdateChartQuery,
  chartOptions,
  onUpdateChartOption,
  onUpdateChartOptions,
  onFieldDrop,
  mode = 'mapping',
  dashboardPages = [],
  fetchDistinctValues,
  sqlBound = false,
}) => {
  const t = useTranslations('chart_specific_fields');
  const td = useTranslations('dashboards');
  const propertyProfile = getWidgetPropertyProfile(chartType);
  const chipStyle: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 4,
    background: 'var(--ant-color-fill-tertiary)',
    border: '1px solid var(--ant-color-border-secondary)',
  };
  const dashboardDefaultPalette = useDashboardStore((s) => {
    const dash = s.dashboards.find((d) => d.id === s.activeDashboardId);
    return dash?.config?.default_color_palette as string | undefined;
  });
  const config = CHART_TYPE_CONFIGS[chartType] || CHART_TYPE_CONFIGS.bar;
  const isAggregate = chartType !== 'scatter';

  const metricIssues = React.useMemo(
    () =>
      validateYMetrics(
        [...(chartQuery.yMetrics || []), ...(chartQuery.yMetricsSecondary || [])],
        selectedTableColumns || [],
      ),
    [chartQuery.yMetrics, chartQuery.yMetricsSecondary, selectedTableColumns],
  );

  // Dynamic sort options based on current selection
  const dynamicSortOptions = React.useMemo(() => {
    const options: { label: string; value: string }[] = [];

    // 1. X-axis / Grouping option
    if (chartQuery.x) {
      const xLabel = selectedTableColumns.find(col => col.value === chartQuery.x)?.label || chartQuery.x;
      options.push({ label: String(xLabel), value: 'x' });
    } else if (chartType === 'scatter' && chartQuery.xMetrics?.[0]) {
      const xm = chartQuery.xMetrics[0];
      const xFLabel = selectedTableColumns.find(col => col.value === xm.field)?.label || xm.field;
      options.push({ label: String(xFLabel), value: 'x' });
    }

    // 2. All primary + secondary metrics (aliases match backend y_0, y_1, …)
    const primaryLen = Array.isArray(chartQuery.yMetrics) ? chartQuery.yMetrics.length : 0;
    const metricEntries = [
      ...(chartQuery.yMetrics || []).map((m: any, i: number) => ({
        m,
        value: i === 0 ? 'y' : `y_${i}`,
      })),
      ...(chartQuery.yMetricsSecondary || []).map((m: any, i: number) => ({
        m,
        value: `y_${primaryLen + i}`,
      })),
    ];
    for (const { m, value } of metricEntries) {
      if (!m?.field) continue;
      const fLabel = selectedTableColumns.find(col => col.value === m.field)?.label || m.field;
      const aggLabel = METRIC_OPTIONS.find(opt => opt.value === m.aggregation)?.label || m.aggregation;
      const label = m.aggregation === 'none' ? String(fLabel) : `${aggLabel} of ${fLabel}`;
      if (!options.some((o) => o.value === value)) {
        options.push({ label, value });
      }
    }

    // 3. Legend / break-by when present
    const legendField = chartQuery.groupField || chartQuery.legend;
    if (legendField) {
      const gLabel = selectedTableColumns.find(col => col.value === legendField)?.label || legendField;
      options.push({ label: `Legend: ${gLabel}`, value: 'group' });
    }

    return options;
  }, [
    chartQuery.x,
    chartQuery.yMetrics,
    chartQuery.yMetricsSecondary,
    chartQuery.xMetrics,
    chartQuery.groupField,
    chartQuery.legend,
    selectedTableColumns,
    chartType,
  ]);

  const handleAggregateChange = (val: boolean) => {
    onUpdateChartQuery('aggregate', val);
    if (val && (!chartQuery.yMetrics || chartQuery.yMetrics.length === 0)) {
    }
  };

  return (
    <>
      {mode === 'mapping' && metricIssues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {metricIssues.map((issue) => (
            <Alert
              key={`${issue.field}-${issue.aggregation}-${issue.message}`}
              type={issue.severity === 'error' ? 'error' : 'warning'}
              showIcon
              style={{ fontSize: 12 }}
              message={issue.message}
            />
          ))}
        </div>
      )}

      {mode === 'mapping' && (chartQuery.x || chartQuery.yMetrics?.length || chartQuery.groupField) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 12,
            fontSize: 11,
            color: 'var(--ant-color-text-secondary)',
          }}
        >
          {chartQuery.x ? (
            <span style={chipStyle}>
              {t('chip_category')}: {chartQuery.x}
              {chartQuery.xGrain ? ` · ${chartQuery.xGrain}` : ''}
            </span>
          ) : null}
          {(chartQuery.yMetrics || []).slice(0, 4).map((m: { field?: string; aggregation?: string }) => (
            <span key={`y-${m.field}`} style={chipStyle}>
              {t('chip_numbers')}: {m.field}
              {m.aggregation && m.aggregation !== 'none' ? ` (${m.aggregation})` : ''}
            </span>
          ))}
          {(chartQuery.yMetrics || []).length > 4 ? (
            <span style={chipStyle}>+{(chartQuery.yMetrics || []).length - 4} more</span>
          ) : null}
          {chartQuery.groupField || chartQuery.legend ? (
            <span style={chipStyle}>
              {t('chip_series')}: {chartQuery.groupField || chartQuery.legend}
            </span>
          ) : null}
          {(chartQuery.drillPath || []).length > 0 ? (
            <span style={chipStyle}>Drill: {(chartQuery.drillPath || []).join(' → ')}</span>
          ) : null}
          {['bar', 'line', 'area', 'heatmap'].includes(chartType) &&
            chartQuery.x &&
            (chartQuery.groupField || chartQuery.legend) &&
            (chartQuery.yMetrics?.length || 0) <= 1 && (
              <Tooltip title={t('swap_rows_columns_hint')}>
                <Button
                  size="small"
                  type="text"
                  icon={<SwapOutlined />}
                  style={{ fontSize: 11, height: 22 }}
                  onClick={() => {
                    const rows = chartQuery.groupField || chartQuery.legend;
                    const cols = chartQuery.x;
                    onUpdateChartQuery('pivotSwap', { x: rows, groupField: cols });
                    if (chartType === 'bar' && onUpdateChartOption) {
                      const nextOrient =
                        chartOptions?.barChartType === 'horizontal' ? 'vertical' : 'horizontal';
                      onUpdateChartOption('barChartType', nextOrient);
                    }
                  }}
                >
                  {t('swap_rows_columns')}
                </Button>
              </Tooltip>
            )}
        </div>
      )}

      {mode === 'mapping' && (() => {
        const mappingFields = config.fields.filter((f) => !f.key.toLowerCase().includes('filter'));
        const basicFields = mappingFields.filter((f) => !f.advanced);
        const advancedFields = mappingFields.filter((f) => f.advanced);
        const hasAdvancedValues = advancedFields.some((f) => {
          if (f.key === 'drillPath') return (chartQuery.drillPath || []).length > 0;
          if (f.key === 'yMetricsSecondary') return (chartQuery.yMetricsSecondary || []).length > 0;
          return Boolean(chartQuery[f.key]);
        });

        const renderMappingField = (field: (typeof mappingFields)[number]) => {
          if (field.dependsOn && !isAggregate) return null;
          if (field.conditionalRender && !field.conditionalRender(chartQuery, chartOptions)) {
            return null;
          }

          switch (field.type) {
            case 'select':
              return (
                <SelectField
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  value={
                    field.key === 'xGrain'
                      ? chartQuery.xGrain || undefined
                      : field.key === 'drillPath'
                        ? chartQuery.drillPath || []
                        : chartQuery[field.key] || undefined
                  }
                  onChange={(val) => {
                    if (field.key === 'xGrain') {
                      onUpdateChartQuery('xGrain', val || undefined);
                      return;
                    }
                    if (field.key === 'drillPath') {
                      const dims = Array.isArray(val) ? val.filter(Boolean) : val ? [val] : [];
                      const reserved = new Set(
                        [chartQuery.x, chartQuery.groupField, chartQuery.legend]
                          .filter(Boolean)
                          .map((s: string) => String(s).toLowerCase()),
                      );
                      onUpdateChartQuery(
                        'drillPath',
                        dims.filter((d: string) => !reserved.has(String(d).toLowerCase())),
                      );
                      return;
                    }
                    onUpdateChartQuery(field.key, val);
                  }}
                  onFieldDrop={(droppedField) => onFieldDrop?.(field.key, droppedField)}
                  options={
                    field.options ||
                    (field.key === 'yMetric' ? METRIC_OPTIONS : selectedTableColumns)
                  }
                  placeholder={
                    field.key === 'xGrain'
                      ? t('date_grain_placeholder')
                      : field.key === 'drillPath'
                        ? t('drill_path_placeholder')
                        : !selectedWidget.dataSourceId
                          ? t('select_data_source_first')
                          : isLoading
                            ? t('loading_columns')
                            : selectedTableColumns.length === 0
                              ? t('no_columns_found')
                              : t('choose_column')
                  }
                  dropHint={
                    field.key === 'x' || field.key === 'groupField' || field.key === 'legend'
                      ? t('drop_category_hint')
                      : t('drop_field_hint')
                  }
                  disabled={
                    field.key === 'yMetric'
                      ? !isAggregate
                      : field.key === 'xGrain'
                        ? !chartQuery.x
                        : !selectedWidget.dataSourceId
                  }
                  isLoading={field.key !== 'yMetric' && field.key !== 'xGrain' && isLoading}
                  showSearch={!field.options}
                  mode={field.mode}
                  allowClear={field.allowClear !== false}
                />
              );

            case 'metric-list': {
              let excludeFields: string[] = [];
              if (field.key === 'yMetrics') {
                excludeFields = [
                  ...(chartQuery.yMetricsSecondary || []).map((m: any) => m.field),
                  ...(chartQuery.xMetrics || []).map((m: any) => m.field),
                ];
              } else if (field.key === 'yMetricsSecondary') {
                excludeFields = (chartQuery.yMetrics || []).map((m: any) => m.field);
              } else if (field.key === 'xMetrics') {
                excludeFields = (chartQuery.yMetrics || []).map((m: any) => m.field);
              }

              return (
                <MetricListField
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  metrics={chartQuery[field.key] || []}
                  onChange={(val) => onUpdateChartQuery(field.key, val)}
                  onFieldDrop={(droppedField) => onFieldDrop?.(field.key, droppedField)}
                  columnOptions={selectedTableColumns}
                  placeholder={
                    !selectedWidget.dataSourceId
                      ? t('select_data_source_first')
                      : isLoading
                        ? t('loading_columns')
                        : t('add_data_fields_here')
                  }
                  dropHint={t('drop_number_hint')}
                  isLoading={isLoading}
                  maxItems={field.maxCount}
                  excludeFields={excludeFields}
                  chartType={chartType}
                  defaultAggregation={sqlBound || chartType === 'scatter' ? 'none' : undefined}
                />
              );
            }

            case 'toggle':
              return (
                <ToggleField
                  key={field.key}
                  label={field.label}
                  checked={field.key === 'aggregate' ? isAggregate : !!chartQuery[field.key]}
                  onChange={(val) => {
                    if (field.key === 'aggregate') {
                      handleAggregateChange(val);
                    } else {
                      onUpdateChartQuery(field.key, val);
                    }
                  }}
                  disabled={field.dependsOn ? !isAggregate : false}
                />
              );

            case 'segmented':
              return (
                <SegmentedField
                  key={field.key}
                  label={field.label}
                  value={chartQuery[field.key] || 'x'}
                  onChange={(val) => onUpdateChartQuery(field.key, val)}
                  options={field.options || []}
                  disabled={field.dependsOn ? !isAggregate : false}
                />
              );

            default:
              return null;
          }
        };

        return (
          <>
            {basicFields.map(renderMappingField)}
            {advancedFields.length > 0 ? (
              <Collapse
                size="small"
                ghost
                className="pp-advanced-collapse"
                defaultActiveKey={hasAdvancedValues ? ['more'] : []}
                items={[
                  {
                    key: 'more',
                    label: (
                      <span className="pp-section-label" style={{ margin: 0 }}>
                        {t('more_build_options')}
                      </span>
                    ),
                    children: (
                      <div className="pp-format-stack">{advancedFields.map(renderMappingField)}</div>
                    ),
                  },
                ]}
              />
            ) : null}
          </>
        );
      })()}

      {mode === 'mapping' && chartType === 'table' && onUpdateChartOption && selectedTableColumns.length > 0 && (
        <TableColumnManager
          columns={selectedTableColumns}
          visibleKeys={(chartOptions?.tableColumnKeys as string[] | undefined) ?? undefined}
          onChange={(keys) => onUpdateChartOption('tableColumnKeys', keys)}
        />
      )}

      {mode === 'customize' && chartType === 'table' && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('table_options')}</PpLabel>
          <div className="pp-format-stack">
          <CheckboxField
            label={t('show_pagination')}
            checked={chartOptions?.showPagination !== false}
            onChange={(v) => onUpdateChartOption('showPagination', v)}
          />
          <CheckboxField
            label={t('bordered')}
            checked={chartOptions?.bordered === true}
            onChange={(v) => onUpdateChartOption('bordered', v)}
          />
          <SelectField
            label={t('row_size')}
            value={chartOptions?.size || 'small'}
            onChange={(v) => onUpdateChartOption('size', v)}
            options={[
              { label: t('size_small'), value: 'small' },
              { label: t('size_middle'), value: 'middle' },
              { label: t('size_large'), value: 'large' },
            ]}
            showSearch={false}
          />
          <InputField
            label={t('rows_per_page')}
            type="number"
            value={chartOptions?.pageSize ?? 10}
            placeholder="10"
            onChange={(v) => onUpdateChartOption('pageSize', v === undefined ? 10 : Math.max(1, Number(v)))}
          />
          <PpLabel>{t('conditional_formatting')}</PpLabel>
          <ConditionalFormattingEditor
            rules={(chartOptions?.conditionalFormatting as ConditionalFormattingRule[]) ?? []}
            onChange={(rules) => onUpdateChartOption('conditionalFormatting', rules)}
            columnOptions={[
              { label: t('category_x'), value: 'x' },
              ...(selectedTableColumns?.slice(0, 20).map((c: { label: string; value: string }) => ({
                label: c.label,
                value: c.value,
              })) ?? []),
            ]}
          />
          </div>
        </div>
      )}

      {mode === 'customize' &&
        !['table', 'embed', 'text', 'image', 'divider', 'slicer', 'filter'].includes(chartType) && (
        <div className="pp-format-section">
          {(chartType === 'bar' || chartType === 'line' || chartType === 'area') && onUpdateChartOption ? (
            <PpLabel>{t('chart_style')}</PpLabel>
          ) : null}
          <div className="pp-format-stack">
          {chartType === 'bar' && onUpdateChartOption && (
            <>
              <SelectField
                label={t('chart_orientation')}
                value={chartOptions?.barChartType || 'vertical'}
                onChange={(value) => onUpdateChartOption('barChartType', value)}
                options={BAR_CHART_TYPE_SELECT_OPTIONS}
                showSearch={false}
              />

              <SelectField
                label={t('stacking')}
                value={chartOptions?.barStackMode || 'none'}
                onChange={(value) => onUpdateChartOption('barStackMode', value)}
                options={BAR_STACK_MODE_OPTIONS}
                showSearch={false}
              />

              {chartOptions?.barChartType === 'combo-line' && (
                <SelectField
                  label={t('line_style')}
                  value={chartOptions?.lineChartType || 'line'}
                  onChange={(value) => onUpdateChartOption('lineChartType', value)}
                  options={LINE_CHART_TYPE_OPTIONS}
                  showSearch={false}
                />
              )}
            </>
          )}

          {(chartType === 'line' || chartType === 'area') && onUpdateChartOption && (
            <>
              <SelectField
                label={t('stacking')}
                value={chartOptions?.lineStackMode || 'none'}
                onChange={(value) => onUpdateChartOption('lineStackMode', value)}
                options={chartType === 'area' ? AREA_STACK_MODE_OPTIONS : LINE_STACK_MODE_OPTIONS}
                showSearch={false}
              />

              <SelectField
                label={t('line_style')}
                value={chartOptions?.lineChartType || 'line'}
                onChange={(value) => onUpdateChartOption('lineChartType', value)}
                options={LINE_CHART_TYPE_OPTIONS}
                showSearch={false}
              />
            </>
          )}

          {propertyProfile.showValueFormat && onUpdateChartOption && (
            <SelectField
              label={t('value_format')}
              value={chartOptions?.valueFormat || 'auto'}
              onChange={(v) => onUpdateChartOption('valueFormat', v === 'auto' ? undefined : v)}
              options={[
                { label: 'Auto (compact K/M)', value: 'auto' },
                { label: 'Full numbers (1,234,567)', value: 'full' },
                { label: 'Compact (1.2K / 3.4M)', value: 'compact' },
                { label: 'Currency ($1,234)', value: 'currency' },
                { label: 'Percentage (12.3%)', value: 'percent' },
              ]}
              showSearch={false}
            />
          )}

          {propertyProfile.showOverlays &&
            ['line', 'area', 'bar', 'scatter'].includes(chartType) &&
            onUpdateChartOption && (
            <>
              <PpLabel>{t('overlays')}</PpLabel>
              <div className="pp-options-grid">
                <CheckboxField
                  label={t('show_trend_line')}
                  checked={chartOptions?.showTrendLine === true}
                  onChange={(v) => onUpdateChartOption('showTrendLine', v)}
                />
                <CheckboxField
                  label={t('show_average_line')}
                  checked={chartOptions?.showAverageLine === true}
                  onChange={(v) => onUpdateChartOption('showAverageLine', v)}
                />
                <CheckboxField
                  label={t('highlight_anomalies')}
                  checked={chartOptions?.showAnomalies === true}
                  onChange={(v) => onUpdateChartOption('showAnomalies', v)}
                />
              </div>
              <PpLabel>{t('reference_lines')}</PpLabel>
              {(chartOptions?.referenceLines || []).map((ref: any, idx: number) => (
                <div key={idx} className="pp-ref-line-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InputField
                      label={`Line ${idx + 1} value`}
                      type="number"
                      value={ref.value ?? ''}
                      placeholder="e.g. 1000"
                      onChange={(val) => {
                        const next = [...(chartOptions.referenceLines || [])];
                        next[idx] = { ...next[idx], value: val !== undefined && val !== '' ? Number(val) : undefined };
                        onUpdateChartOption('referenceLines', next.filter((r: any) => r.value != null));
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InputField
                      label={t('ref_line_label')}
                      value={ref.label || ''}
                      placeholder="Goal"
                      onChange={(val) => {
                        const next = [...(chartOptions.referenceLines || [])];
                        next[idx] = { ...next[idx], label: val };
                        onUpdateChartOption('referenceLines', next);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="pp-ref-line-remove"
                    onClick={() => {
                      const next = (chartOptions.referenceLines || []).filter((_: any, i: number) => i !== idx);
                      onUpdateChartOption('referenceLines', next);
                    }}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
              <button
                type="button"
                className="pp-text-action"
                onClick={() => {
                  const next = [...(chartOptions?.referenceLines || []), { value: undefined, label: 'Goal', color: '#faad14' }];
                  onUpdateChartOption('referenceLines', next);
                }}
              >
                + Add reference line
              </button>
            </>
          )}

          {(chartType === 'pie' || chartType === 'donut') && onUpdateChartOption && (
            <SelectField
              label={t('donut_hole')}
              value={chartOptions?.innerRadius ?? (chartType === 'donut' ? 40 : 0)}
              onChange={(value) => onUpdateChartOption('innerRadius', value)}
              options={[0, 10, 20, 30, 40, 50, 60, 70, 80].map((v) => ({ label: `${v}%`, value: v }))}
              showSearch={false}
            />
          )}

          {chartType === 'stat' && onUpdateChartOption && (
            <>
              <SelectField
                label={t('stat_format')}
                value={chartOptions?.format || 'number'}
                onChange={(value) => onUpdateChartOption('format', value)}
                options={[
                  { label: 'Number', value: 'number' },
                  { label: 'Currency', value: 'currency' },
                  { label: 'Percent', value: 'percent' },
                ]}
                showSearch={false}
              />
              <CheckboxField
                label={t('stat_show_trend')}
                checked={chartOptions?.showTrend !== false}
                onChange={(checked) => onUpdateChartOption('showTrend', checked)}
              />
              <StatKpiFields chartOptions={chartOptions || {}} onUpdate={onUpdateChartOption} />
              {chartOptions?.showSparkline && (
                <SelectField
                  label={t('stat_sparkline_type')}
                  value={chartOptions?.sparklineType || 'line'}
                  onChange={(v) => onUpdateChartOption('sparklineType', v)}
                  options={[
                    { label: t('stat_sparkline_line'), value: 'line' },
                    { label: t('stat_sparkline_bar'), value: 'bar' },
                  ]}
                  showSearch={false}
                />
              )}
              <SelectField
                label={t('stat_comparison_period')}
                hint={t('stat_comparison_period_hint')}
                value={chartOptions?.comparisonPeriod || 'none'}
                onChange={(v) => {
                  const labels: Record<string, string> = {
                    wow: COMPARISON_PERIOD_LABELS.wow,
                    mom: COMPARISON_PERIOD_LABELS.mom,
                    qoq: COMPARISON_PERIOD_LABELS.qoq,
                    yoy: COMPARISON_PERIOD_LABELS.yoy,
                    none: '',
                  };
                  const legacyPrefixed = Object.values(COMPARISON_PERIOD_LABELS).map((l) => `vs ${l}`);
                  onUpdateChartOption('comparisonPeriod', v === 'none' ? undefined : v);
                  const prevLabel = String(chartOptions?.comparisonPeriodLabel || '');
                  const prevAuto =
                    Object.values(labels).includes(prevLabel) ||
                    legacyPrefixed.includes(prevLabel) ||
                    prevLabel === '';
                  if (prevAuto) onUpdateChartOption('comparisonPeriodLabel', labels[v] || '');
                }}
                options={[
                  { label: t('stat_comparison_none'), value: 'none' },
                  { label: t('stat_comparison_wow'), value: 'wow' },
                  { label: t('stat_comparison_mom'), value: 'mom' },
                  { label: t('stat_comparison_qoq'), value: 'qoq' },
                  { label: t('stat_comparison_yoy'), value: 'yoy' },
                ]}
                showSearch={false}
              />
            </>
          )}

          {chartType === 'gauge' && onUpdateChartOption && (
            <>
              <PpLabel>{t('gauge_range')}</PpLabel>
              <InputField
                label={t('min_value')}
                type="number"
                value={chartOptions?.gaugeMin}
                placeholder="0"
                onChange={(v) => onUpdateChartOption('gaugeMin', v === undefined ? undefined : Number(v))}
              />
              <InputField
                label={t('max_value')}
                type="number"
                value={chartOptions?.gaugeMax}
                placeholder="Auto"
                onChange={(v) => onUpdateChartOption('gaugeMax', v === undefined ? undefined : Number(v))}
              />
              <InputField
                label={t('target_goal')}
                type="number"
                value={chartOptions?.gaugeTarget}
                placeholder="Optional target line"
                onChange={(v) => onUpdateChartOption('gaugeTarget', v === undefined ? undefined : Number(v))}
              />
              <InputField
                label={t('gauge_label')}
                value={chartOptions?.gaugeLabel || ''}
                placeholder={t('gauge_label_placeholder')}
                onChange={(v) => onUpdateChartOption('gaugeLabel', v)}
              />
              <InputField
                label={t('gauge_unit')}
                value={chartOptions?.gaugeUnit || ''}
                placeholder={t('gauge_unit_placeholder')}
                onChange={(v) => onUpdateChartOption('gaugeUnit', v)}
              />
            </>
          )}

          {chartType === 'heatmap' && onUpdateChartOption && (
            <>
              <PpLabel>{t('heatmap_color_scale')}</PpLabel>
              <InputField
                label={t('low_color')}
                value={chartOptions?.colorFrom || '#e0f3f8'}
                placeholder="#e0f3f8"
                onChange={(v) => onUpdateChartOption('colorFrom', v)}
              />
              <InputField
                label={t('mid_color')}
                value={chartOptions?.colorMid || ''}
                placeholder={t('mid_color_placeholder')}
                onChange={(v) => onUpdateChartOption('colorMid', v || undefined)}
              />
              <InputField
                label={t('high_color')}
                value={chartOptions?.colorTo || '#004a4d'}
                placeholder="#004a4d"
                onChange={(v) => onUpdateChartOption('colorTo', v)}
              />
            </>
          )}

          {chartType === 'bullet' && onUpdateChartOption && (
            <>
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
                {t('bullet_thresholds')}
              </Divider>
              <InputField
                label={t('warn_threshold')}
                type="number"
                value={chartOptions?.bulletThresholdWarn ?? 60}
                placeholder="60"
                onChange={(v) => onUpdateChartOption('bulletThresholdWarn', v === undefined ? 60 : Number(v))}
              />
              <InputField
                label={t('ok_threshold')}
                type="number"
                value={chartOptions?.bulletThresholdOk ?? 80}
                placeholder="80"
                onChange={(v) => onUpdateChartOption('bulletThresholdOk', v === undefined ? 80 : Number(v))}
              />
              <InputField
                label={t('max_value_cap')}
                type="number"
                value={chartOptions?.bulletMax}
                placeholder="Auto"
                onChange={(v) => onUpdateChartOption('bulletMax', v === undefined ? undefined : Number(v))}
              />
              <InputField
                label={t('actual_label')}
                value={chartOptions?.bulletActualLabel || ''}
                placeholder="Actual"
                onChange={(v) => onUpdateChartOption('bulletActualLabel', v)}
              />
            </>
          )}

          {chartType === 'geo' && onUpdateChartOption && (
            <>
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
                {t('geo_map_options')}
              </Divider>
              <InputField
                label={t('value_label')}
                value={chartOptions?.valueLabel || ''}
                placeholder="Value"
                onChange={(v) => onUpdateChartOption('valueLabel', v)}
              />
              <InputField
                label={t('low_color')}
                value={chartOptions?.colorFrom || '#b7e4f9'}
                placeholder="#b7e4f9"
                onChange={(v) => onUpdateChartOption('colorFrom', v)}
              />
              <InputField
                label={t('high_color')}
                value={chartOptions?.colorTo || '#004a80'}
                placeholder="#004a80"
                onChange={(v) => onUpdateChartOption('colorTo', v)}
              />
              <CheckboxField
                label={t('allow_zoom_pan')}
                checked={chartOptions?.roam === true}
                onChange={(v) => onUpdateChartOption('roam', v)}
              />
              <CheckboxField
                label={t('show_country_labels')}
                checked={chartOptions?.showLabels === true}
                onChange={(v) => onUpdateChartOption('showLabels', v)}
              />
              <InputField
                label={t('custom_geojson_url')}
                value={chartOptions?.geoJsonUrl || ''}
                placeholder="https://… (optional)"
                onChange={(v) => onUpdateChartOption('geoJsonUrl', v || undefined)}
              />
            </>
          )}
          </div>
        </div>
      )}

      {/* Legend sort / limit — only for types with multi-series legends */}
      {mode === 'customize' && propertyProfile.showLegendSeriesControls && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('legend_series')}</PpLabel>
          <div className="pp-format-stack">
          <SelectField
            label={t('series_sort_order')}
            value={chartOptions?.legendSort || 'none'}
            onChange={(v) => onUpdateChartOption('legendSort', v === 'none' ? undefined : v)}
            options={[
              { label: t('series_sort_default'), value: 'none' },
              { label: t('series_sort_desc'), value: 'desc' },
              { label: t('series_sort_asc'), value: 'asc' },
            ]}
            showSearch={false}
          />
          <InputField
            label={t('max_series_shown')}
            type="number"
            value={chartOptions?.legendLimit ?? chartQuery?.seriesLimit ?? ''}
            placeholder="All"
            onChange={(v) => {
              const next = v ? Math.max(1, parseInt(String(v), 10)) : undefined;
              onUpdateChartOption('legendLimit', next);
              onUpdateChartQuery('seriesLimit', next);
            }}
          />
          </div>
        </div>
      )}

      {mode === 'customize' &&
        propertyProfile.kind !== 'content' &&
        propertyProfile.kind !== 'control' &&
        chartType !== 'stat' &&
        onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{td('header_icon_label')}</PpLabel>
          <div className="pp-format-stack">
            <IconPicker
              value={chartOptions?.headerIcon}
              onChange={(icon) => onUpdateChartOption('headerIcon', icon || undefined)}
            />
          </div>
        </div>
      )}

      {/* Embed widget customize options (outside of 'customize !== table' guard) */}
      {mode === 'customize' && chartType === 'embed' && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('embed_section')}</PpLabel>
          <div className="pp-format-stack">
          <InputField
            label={t('embed_url')}
            value={chartOptions?.url || ''}
            placeholder="https://…"
            onChange={(v) => onUpdateChartOption('url', v)}
          />
          <InputField
            label={t('embed_frame_title')}
            value={chartOptions?.frameTitle || ''}
            placeholder={t('embed_frame_title_placeholder')}
            onChange={(v) => onUpdateChartOption('frameTitle', v)}
          />
          <CheckboxField
            label={t('embed_allow_scrolling')}
            checked={chartOptions?.allowScrolling !== false}
            onChange={(v) => onUpdateChartOption('allowScrolling', v)}
          />
          <InputField
            label={t('corner_radius')}
            type="number"
            value={chartOptions?.borderRadius ?? 0}
            placeholder="0"
            onChange={(v) => onUpdateChartOption('borderRadius', Number(v) || 0)}
          />
          </div>
        </div>
      )}

      {mode === 'customize' && chartType === 'image' && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('image_section')}</PpLabel>
          <div className="pp-format-stack">
            <InputField
              label={t('image_url')}
              value={chartOptions?.imageUrl || chartOptions?.src || ''}
              placeholder={t('image_url_placeholder')}
              onChange={(v) => onUpdateChartOption('imageUrl', v)}
            />
            <InputField
              label={t('image_alt_text')}
              value={chartOptions?.altText || ''}
              placeholder={t('image_alt_placeholder')}
              onChange={(v) => onUpdateChartOption('altText', v)}
            />
            <SelectField
              label={t('image_object_fit')}
              value={chartOptions?.objectFit || 'contain'}
              onChange={(v) => onUpdateChartOption('objectFit', v)}
              options={[
                { label: t('object_fit_contain'), value: 'contain' },
                { label: t('object_fit_cover'), value: 'cover' },
                { label: t('object_fit_fill'), value: 'fill' },
                { label: t('object_fit_none'), value: 'none' },
              ]}
              showSearch={false}
            />
            <InputField
              label={t('corner_radius')}
              type="number"
              value={chartOptions?.borderRadius ?? 0}
              placeholder="0"
              onChange={(v) => onUpdateChartOption('borderRadius', Number(v) || 0)}
            />
          </div>
        </div>
      )}

      {mode === 'customize' && chartType === 'divider' && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('section_divider')}</PpLabel>
          <div className="pp-format-stack">
            <InputField
              label={t('section_title')}
              value={chartOptions?.sectionTitle || ''}
              placeholder={t('section_title_placeholder')}
              onChange={(v) => onUpdateChartOption('sectionTitle', v)}
            />
            <CheckboxField
              label={t('section_title_uppercase')}
              checked={chartOptions?.uppercase === true}
              onChange={(v) => onUpdateChartOption('uppercase', v)}
            />
            <CheckboxField
              label={t('section_hide_line')}
              checked={chartOptions?.hideLine === true}
              onChange={(v) => onUpdateChartOption('hideLine', v)}
            />
            <InputField
              label={t('section_title_size')}
              type="number"
              value={chartOptions?.titleSize ?? 13}
              placeholder="13"
              onChange={(v) => onUpdateChartOption('titleSize', Number(v) || 13)}
            />
            <div>
              <PpLabel>{t('section_title_color')}</PpLabel>
              <ColorPicker
                size="small"
                value={chartOptions?.titleColor || undefined}
                onChange={(c) => onUpdateChartOption('titleColor', c.toHexString())}
                showText
                allowClear
              />
            </div>
            <div>
              <PpLabel>{td('icon_label')}</PpLabel>
              <IconPicker
                value={chartOptions?.icon}
                legacyIconName={chartOptions?.iconName}
                onChange={(icon) => {
                  onUpdateChartOption('icon', icon || undefined);
                  if (!icon) onUpdateChartOption('iconName', undefined);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'customize' && chartType === 'text' && onUpdateChartOption && (
        <div className="pp-format-section">
          <PpLabel>{t('text_section')}</PpLabel>
          <div className="pp-format-stack">
            <SelectField
              label={t('text_default_size')}
              value={chartOptions?.fontSize || 14}
              onChange={(v) => onUpdateChartOption('fontSize', Number(v) || 14)}
              options={[8, 10, 12, 14, 16, 18, 20, 24, 32, 48].map((s) => ({
                label: `${s}px`,
                value: s,
              }))}
              showSearch={false}
            />
            <SelectField
              label={t('text_align')}
              value={chartOptions?.textAlign || 'left'}
              onChange={(v) => onUpdateChartOption('textAlign', v)}
              options={[
                { label: t('align_left'), value: 'left' },
                { label: t('align_center'), value: 'center' },
                { label: t('align_right'), value: 'right' },
              ]}
              showSearch={false}
            />
            <div>
              <PpLabel>{t('text_color')}</PpLabel>
              <ColorPicker
                size="small"
                value={chartOptions?.color || undefined}
                onChange={(c) => onUpdateChartOption('color', c.toHexString())}
                showText
                allowClear
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'colors' && propertyProfile.showColorPalette && (
        <div className="pp-format-section">
          {onUpdateChartOption && (
            <>
              <PpLabel>{t('colors')}</PpLabel>
              <div className="pp-format-stack">
              <ColorPaletteField
                label={t('widget_color_palette')}
                value={chartOptions?.colorPalette ?? WIDGET_PALETTE_INHERIT}
                chartOptions={chartOptions}
                dashboardDefaultPalette={dashboardDefaultPalette}
                onChange={(value) => onUpdateChartOption('colorPalette', value)}
                onUpdateChartOptions={onUpdateChartOptions}
              />
              
              {chartOptions?.colorPalette === 'custom' && (
                <ColorPickerField
                  label={t('primary_color')}
                  value={chartOptions?.customColor || '#00c2cb'}
                  inverted={chartOptions?.paletteInverted || false}
                  onChange={(color, palette, inverted) => {
                    if (onUpdateChartOptions) {
                      onUpdateChartOptions({
                        customColor: color,
                        customPalette: palette,
                        paletteInverted: inverted,
                        colorPalette: 'custom'
                      });
                    }
                  }}
                />
              )}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'advanced' && (
        <>
          <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SelectField
              label={t('sort_by')}
              value={chartQuery.sortBy === 'record_order' ? undefined : chartQuery.sortBy}
              onChange={(val) => onUpdateChartQuery('sortBy', val || 'record_order')}
              options={dynamicSortOptions}
              placeholder={t('default_order')}
              showSearch={false}
            />

            {chartQuery.sortBy && chartQuery.sortBy !== 'record_order' && (
              <div style={{ marginTop: -8, marginBottom: 8 }}>
                <CheckboxField 
                  label={t('sort_ascending')} 
                  checked={chartQuery.sortOrder === 'asc'} 
                  onChange={(checked) => onUpdateChartQuery('sortOrder', checked ? 'asc' : 'desc')} 
                />
              </div>
            )}

            <InputField
              label={t('row_limit')}
              type="number"
              value={chartQuery.limit}
              placeholder="Default (5000)"
              onChange={(val) => {
                const numVal = Math.max(1, Number(val));
                onUpdateChartQuery('limit', val === undefined ? undefined : numVal);
              }}
            />
          </div>

          {(chartQuery.drillPath?.length ?? 0) > 0 ? (
            <>
              <Divider className="panel-divider" style={{ margin: '16px 0' }} />
              <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SelectField
                  label={t('interaction_mode')}
                  hint={t('drill_shift_hint')}
                  value={chartQuery.interactionMode || 'drill'}
                  onChange={(val) => onUpdateChartQuery('interactionMode', val)}
                  options={[
                    { label: t('interaction_drill'), value: 'drill' },
                    { label: t('interaction_cross_filter'), value: 'cross_filter' },
                  ]}
                  showSearch={false}
                />
              </div>
            </>
          ) : null}

          {dashboardPages.length > 1 && (
            <>
              <Divider className="panel-divider" style={{ margin: '16px 0' }} />
              <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SelectField
                  label={t('drill_through_target_page')}
                  hint={t('drill_through_hint')}
                  value={chartQuery.drillThrough?.targetPageId || undefined}
                  onChange={(pageId) => {
                    if (!pageId) {
                      onUpdateChartQuery('drillThrough', undefined);
                      return;
                    }
                    onUpdateChartQuery('drillThrough', {
                      ...(chartQuery.drillThrough || {}),
                      targetPageId: pageId,
                    });
                  }}
                  options={dashboardPages.map((p) => ({ label: p.name, value: p.id }))}
                  placeholder={t('drill_through_none')}
                  showSearch={false}
                  allowClear
                />
                {chartQuery.drillThrough?.targetPageId ? (
                  <SelectField
                    label={t('drill_through_filter_field')}
                    value={chartQuery.drillThrough?.filterField || undefined}
                    onChange={(val) =>
                      onUpdateChartQuery('drillThrough', {
                        ...chartQuery.drillThrough,
                        filterField: val || undefined,
                      })
                    }
                    options={selectedTableColumns}
                    placeholder={chartQuery.x || t('choose_column')}
                    showSearch
                    allowClear
                  />
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      {/* Visual filters live on the Filters tab (industry standard: Build ≠ Filters) */}
      {mode === 'filters' && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {config.fields.filter(f => f.key.toLowerCase().includes('filter')).length === 0 ? (
            <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
              This widget type does not support visual-level filters.
            </div>
          ) : (
            config.fields.filter(f => f.key.toLowerCase().includes('filter')).map((field) => {
              if (field.conditionalRender && !field.conditionalRender(chartQuery, chartOptions)) {
                return null;
              }

              switch (field.type) {
                case 'filter-list':
                  return (
                    <FilterListField
                      key={field.key}
                      label={field.label}
                      required={field.required}
                      filters={chartQuery[field.key] || []}
                      onChange={(val) => onUpdateChartQuery(field.key, val)}
                      onFieldDrop={(droppedField) => onFieldDrop?.(field.key, droppedField)}
                      columnOptions={selectedTableColumns}
                      isLoading={isLoading}
                      fetchDistinctValues={fetchDistinctValues}
                    />
                  );

                case 'metric-filter-list': {
                  const currentMetrics = [
                    ...(chartQuery.yMetrics || []),
                    ...(chartQuery.yMetricsSecondary || []),
                    ...(chartQuery.xMetrics || []),
                  ];
                  if (currentMetrics.length === 0) {
                    return (
                      <div
                        key={field.key}
                        style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}
                      >
                        {t('metric_filters_need_values')}
                      </div>
                    );
                  }

                  const metricOptions = currentMetrics.map((m: any) => {
                    const fieldLabel = selectedTableColumns.find(col => col.value === m.field)?.label || m.field;
                    const aggLabel = METRIC_OPTIONS.find(opt => opt.value === m.aggregation)?.label || m.aggregation;
                    return {
                      label: m.aggregation === 'none' ? String(fieldLabel) : `${aggLabel} of ${fieldLabel}`,
                      value: `${m.field}|${m.aggregation}`,
                      field: m.field,
                      aggregation: m.aggregation
                    };
                  });

                  return (
                    <MetricFilterListField
                      key={field.key}
                      label={field.label}
                      required={field.required}
                      filters={chartQuery[field.key] || []}
                      onChange={(val) => onUpdateChartQuery(field.key, val)}
                      metricOptions={metricOptions}
                      isLoading={isLoading}
                      placeholder={t('metric_filters_placeholder')}
                    />
                  );
                }
                default:
                  return null;
              }
            })
          )}
        </div>
      )}
    </>
  );
};
