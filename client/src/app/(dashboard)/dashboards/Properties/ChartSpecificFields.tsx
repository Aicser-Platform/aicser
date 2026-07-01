import React from 'react';
import { Divider } from 'antd';
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
import { resolvePropertyFieldHint } from '../utils/propertyFieldHints';
import { useDashboardStore } from '../stores/useDashboardStore';
import { WIDGET_PALETTE_INHERIT } from '../utils/chartPaletteCatalog';
import { ConditionalFormattingEditor } from './ConditionalFormattingEditor';
import type { ConditionalFormattingRule } from './ConditionalFormattingEditor';
import { TableColumnManager } from './TableColumnManager';
import { RelatedJoinsPicker } from './RelatedJoinsPicker';
import type { DashboardFieldDragPayload } from '../utils/dashboardFieldDrag';

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
  mode?: 'mapping' | 'customize' | 'colors' | 'advanced';
  dashboardPages?: { id: string; name: string }[];
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
}) => {
  const t = useTranslations('chart_specific_fields');
  const dashboardDefaultPalette = useDashboardStore((s) => {
    const dash = s.dashboards.find((d) => d.id === s.activeDashboardId);
    return dash?.config?.default_color_palette as string | undefined;
  });
  const config = CHART_TYPE_CONFIGS[chartType] || CHART_TYPE_CONFIGS.bar;
  const isAggregate = chartType !== 'scatter';

  // Dynamic sort options based on current selection
  const dynamicSortOptions = React.useMemo(() => {
    const options = [];
    
    // 1. X-axis / Grouping option
    if (chartQuery.x) {
      const xLabel = selectedTableColumns.find(col => col.value === chartQuery.x)?.label || chartQuery.x;
      options.push({ label: String(xLabel), value: 'x' });
    } else if (chartType === 'scatter' && chartQuery.xMetrics?.[0]) {
      const xm = chartQuery.xMetrics[0];
      const xFLabel = selectedTableColumns.find(col => col.value === xm.field)?.label || xm.field;
      options.push({ label: String(xFLabel), value: 'x' });
    }

    // 2. Y-axis / Metric option (Primary)
    const firstMetric = chartQuery.yMetrics?.[0];
    if (firstMetric) {
      const fLabel = selectedTableColumns.find(col => col.value === firstMetric.field)?.label || firstMetric.field;
      const aggLabel = METRIC_OPTIONS.find(opt => opt.value === firstMetric.aggregation)?.label || firstMetric.aggregation;
      const label = firstMetric.aggregation === 'none' ? String(fLabel) : `${aggLabel} of ${fLabel}`;
      options.push({ label, value: 'y' });
    }

    return options;
  }, [chartQuery.x, chartQuery.yMetrics, chartQuery.xMetrics, selectedTableColumns, chartType]);

  const handleAggregateChange = (val: boolean) => {
    onUpdateChartQuery('aggregate', val);
    if (val && (!chartQuery.yMetrics || chartQuery.yMetrics.length === 0)) {
    }
  };

  return (
    <>
      {mode === 'mapping' && config.fields.filter(f => !f.key.toLowerCase().includes('filter')).map((field) => {
        if (field.dependsOn && !isAggregate) {
          return null;
        }

        if (field.conditionalRender && !field.conditionalRender(chartQuery, chartOptions)) {
          return null;
        }

        switch (field.type) {
          case 'select':
            return (
              <SelectField
                key={field.key}
                label={field.label}
                hint={resolvePropertyFieldHint(field.key, t)}
                required={field.required}
                value={chartQuery[field.key] || undefined}
                onChange={(val) => onUpdateChartQuery(field.key, val)}
                onFieldDrop={(droppedField) => onFieldDrop?.(field.key, droppedField)}
                options={field.options || (field.key === 'yMetric' ? METRIC_OPTIONS : selectedTableColumns)}
                placeholder={
                  !selectedWidget.dataSourceId
                    ? t('select_data_source_first')
                    : isLoading
                    ? t('loading_columns')
                    : selectedTableColumns.length === 0
                    ? t('no_columns_found')
                    : t('choose_column')
                }
                disabled={
                  field.key === 'yMetric'
                    ? !isAggregate
                    : !selectedWidget.dataSourceId
                }
                isLoading={field.key !== 'yMetric' && isLoading}
                showSearch={!field.options}
              />
            );

          case 'metric-list':
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
                hint={resolvePropertyFieldHint(field.key, t)}
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
                isLoading={isLoading}
                maxItems={field.maxCount}
                excludeFields={excludeFields}
                chartType={chartType}
              />
            );

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
      })}

      {mode === 'mapping' && chartType === 'table' && onUpdateChartOption && selectedTableColumns.length > 0 && (
        <TableColumnManager
          columns={selectedTableColumns}
          visibleKeys={(chartOptions?.tableColumnKeys as string[] | undefined) ?? undefined}
          onChange={(keys) => onUpdateChartOption('tableColumnKeys', keys)}
        />
      )}

      {mode === 'customize' && chartType === 'table' && onUpdateChartOption && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
            Table Options
          </Divider>
          <CheckboxField
            label="Show Pagination"
            checked={chartOptions?.showPagination !== false}
            onChange={(v) => onUpdateChartOption('showPagination', v)}
          />
          <CheckboxField
            label="Bordered"
            checked={chartOptions?.bordered === true}
            onChange={(v) => onUpdateChartOption('bordered', v)}
          />
          <SelectField
            label="Row Size"
            value={chartOptions?.size || 'small'}
            onChange={(v) => onUpdateChartOption('size', v)}
            options={[
              { label: 'Small', value: 'small' },
              { label: 'Middle', value: 'middle' },
              { label: 'Large', value: 'large' },
            ]}
            showSearch={false}
          />
          <InputField
            label="Rows Per Page"
            type="number"
            value={chartOptions?.pageSize ?? 10}
            placeholder="10"
            onChange={(v) => onUpdateChartOption('pageSize', v === undefined ? 10 : Math.max(1, Number(v)))}
          />
          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
            Conditional Formatting
          </Divider>
          <ConditionalFormattingEditor
            rules={(chartOptions?.conditionalFormatting as ConditionalFormattingRule[]) ?? []}
            onChange={(rules) => onUpdateChartOption('conditionalFormatting', rules)}
            columnOptions={[
              { label: 'Category (x)', value: 'x' },
              ...(selectedTableColumns?.slice(0, 20).map((c: { label: string; value: string }) => ({
                label: c.label,
                value: c.value,
              })) ?? []),
            ]}
          />
        </div>
      )}

      {mode === 'customize' && chartType !== 'table' && chartType !== 'embed' && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {chartType === 'bar' && onUpdateChartOption && (
            <>
              <SelectField
                label="Chart Orientation"
                value={chartOptions?.barChartType || 'vertical'}
                onChange={(value) => onUpdateChartOption('barChartType', value)}
                options={BAR_CHART_TYPE_SELECT_OPTIONS}
                showSearch={false}
              />

              <SelectField
                label="Stacking"
                value={chartOptions?.barStackMode || 'none'}
                onChange={(value) => onUpdateChartOption('barStackMode', value)}
                options={BAR_STACK_MODE_OPTIONS}
                showSearch={false}
              />

              {chartOptions?.barChartType === 'combo-line' && (
                <SelectField
                  label="Line Style"
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
                label="Stacking"
                value={chartOptions?.lineStackMode || 'none'}
                onChange={(value) => onUpdateChartOption('lineStackMode', value)}
                options={chartType === 'area' ? AREA_STACK_MODE_OPTIONS : LINE_STACK_MODE_OPTIONS}
                showSearch={false}
              />

              <SelectField
                label="Line Style"
                value={chartOptions?.lineChartType || 'line'}
                onChange={(value) => onUpdateChartOption('lineChartType', value)}
                options={LINE_CHART_TYPE_OPTIONS}
                showSearch={false}
              />
            </>
          )}

          {/* Value Format */}
          {!['pie', 'donut', 'table', 'geo', 'embed', 'stat', 'text', 'divider', 'image'].includes(chartType) && onUpdateChartOption && (
            <SelectField
              label="Value Format"
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

          {/* Trend & Reference Lines (line, area, bar, scatter) */}
          {['line', 'area', 'bar', 'scatter'].includes(chartType) && onUpdateChartOption && (
            <>
              <CheckboxField
                label="Show Trend Line"
                checked={chartOptions?.showTrendLine === true}
                onChange={(v) => onUpdateChartOption('showTrendLine', v)}
              />
              <CheckboxField
                label="Show Average Line"
                checked={chartOptions?.showAverageLine === true}
                onChange={(v) => onUpdateChartOption('showAverageLine', v)}
              />
              <CheckboxField
                label="Highlight Anomalies"
                checked={chartOptions?.showAnomalies === true}
                onChange={(v) => onUpdateChartOption('showAnomalies', v)}
              />
              {/* Multiple reference lines */}
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
                Reference Lines
              </Divider>
              {(chartOptions?.referenceLines || []).map((ref: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
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
                  <div style={{ flex: 1 }}>
                    <InputField
                      label="Label"
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
                    style={{ marginBottom: 8, padding: '4px 6px', cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: 'transparent', color: '#ff4d4f' }}
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
                style={{ fontSize: 12, color: 'var(--ant-color-primary)', cursor: 'pointer', background: 'none', border: 'none', padding: '2px 0' }}
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
              <InputField
                label={t('stat_threshold_warn')}
                type="number"
                value={chartOptions?.thresholdWarn}
                placeholder="—"
                onChange={(val) => onUpdateChartOption('thresholdWarn', val === undefined ? undefined : Number(val))}
              />
              <InputField
                label={t('stat_threshold_critical')}
                type="number"
                value={chartOptions?.thresholdCritical}
                placeholder="—"
                onChange={(val) =>
                  onUpdateChartOption('thresholdCritical', val === undefined ? undefined : Number(val))
                }
              />
              <SelectField
                label={t('stat_threshold_direction')}
                value={chartOptions?.thresholdDirection || 'above'}
                onChange={(value) => onUpdateChartOption('thresholdDirection', value)}
                options={[
                  { label: t('stat_threshold_above'), value: 'above' },
                  { label: t('stat_threshold_below'), value: 'below' },
                ]}
                showSearch={false}
              />
              {/* Sparkline */}
              <CheckboxField
                label="Show Sparkline"
                checked={chartOptions?.showSparkline === true}
                onChange={(checked) => onUpdateChartOption('showSparkline', checked)}
              />
              {chartOptions?.showSparkline && (
                <SelectField
                  label="Sparkline Type"
                  value={chartOptions?.sparklineType || 'line'}
                  onChange={(v) => onUpdateChartOption('sparklineType', v)}
                  options={[
                    { label: 'Line', value: 'line' },
                    { label: 'Bar', value: 'bar' },
                  ]}
                  showSearch={false}
                />
              )}
              {/* Layout variant */}
              <SelectField
                label="Layout"
                value={chartOptions?.layout || 'default'}
                onChange={(v) => onUpdateChartOption('layout', v)}
                options={[
                  { label: 'Default', value: 'default' },
                  { label: 'Compact', value: 'compact' },
                  { label: 'Centered', value: 'centered' },
                ]}
                showSearch={false}
              />
              {/* Comparative period (WoW / MoM / YoY) */}
              <SelectField
                label="Comparative period"
                value={chartOptions?.comparisonPeriod || 'none'}
                onChange={(v) => {
                  const labels: Record<string, string> = {
                    wow: 'vs last week',
                    mom: 'vs last month',
                    qoq: 'vs last quarter',
                    yoy: 'vs last year',
                    none: '',
                  };
                  onUpdateChartOption('comparisonPeriod', v === 'none' ? undefined : v);
                  // Auto-fill label if it's currently empty or matches a previous auto-label
                  const prevLabel = chartOptions?.comparisonPeriodLabel || '';
                  const prevAuto = Object.values(labels).includes(prevLabel) || prevLabel === '';
                  if (prevAuto) onUpdateChartOption('comparisonPeriodLabel', labels[v] || '');
                }}
                options={[
                  { label: 'None', value: 'none' },
                  { label: 'Week over Week (WoW)', value: 'wow' },
                  { label: 'Month over Month (MoM)', value: 'mom' },
                  { label: 'Quarter over Quarter (QoQ)', value: 'qoq' },
                  { label: 'Year over Year (YoY)', value: 'yoy' },
                ]}
                showSearch={false}
              />
              {/* Comparison period label */}
              <InputField
                label="Comparison Label"
                value={chartOptions?.comparisonPeriodLabel || ''}
                placeholder="e.g. vs last month"
                onChange={(v) => onUpdateChartOption('comparisonPeriodLabel', v)}
              />
            </>
          )}

          {chartType === 'bullet' && onUpdateChartOption && (
            <>
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
                Bullet Chart Thresholds
              </Divider>
              <InputField
                label="Warn Threshold"
                type="number"
                value={chartOptions?.bulletThresholdWarn ?? 60}
                placeholder="60"
                onChange={(v) => onUpdateChartOption('bulletThresholdWarn', v === undefined ? 60 : Number(v))}
              />
              <InputField
                label="OK Threshold"
                type="number"
                value={chartOptions?.bulletThresholdOk ?? 80}
                placeholder="80"
                onChange={(v) => onUpdateChartOption('bulletThresholdOk', v === undefined ? 80 : Number(v))}
              />
              <InputField
                label="Max Value"
                type="number"
                value={chartOptions?.bulletMax}
                placeholder="Auto"
                onChange={(v) => onUpdateChartOption('bulletMax', v === undefined ? undefined : Number(v))}
              />
              <InputField
                label="Actual Label"
                value={chartOptions?.bulletActualLabel || ''}
                placeholder="Actual"
                onChange={(v) => onUpdateChartOption('bulletActualLabel', v)}
              />
            </>
          )}

          {chartType === 'geo' && onUpdateChartOption && (
            <>
              <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
                Geo Map Options
              </Divider>
              <InputField
                label="Value Label"
                value={chartOptions?.valueLabel || ''}
                placeholder="Value"
                onChange={(v) => onUpdateChartOption('valueLabel', v)}
              />
              <InputField
                label="Low Color"
                value={chartOptions?.colorFrom || '#b7e4f9'}
                placeholder="#b7e4f9"
                onChange={(v) => onUpdateChartOption('colorFrom', v)}
              />
              <InputField
                label="High Color"
                value={chartOptions?.colorTo || '#004a80'}
                placeholder="#004a80"
                onChange={(v) => onUpdateChartOption('colorTo', v)}
              />
              <CheckboxField
                label="Allow zoom / pan"
                checked={chartOptions?.roam === true}
                onChange={(v) => onUpdateChartOption('roam', v)}
              />
              <CheckboxField
                label="Show country labels"
                checked={chartOptions?.showLabels === true}
                onChange={(v) => onUpdateChartOption('showLabels', v)}
              />
              <InputField
                label="Custom GeoJSON URL"
                value={chartOptions?.geoJsonUrl || ''}
                placeholder="https://… (optional)"
                onChange={(v) => onUpdateChartOption('geoJsonUrl', v || undefined)}
              />
            </>
          )}
        </div>
      )}

      {/* Legend sort / limit — applicable to multi-series chart types */}
      {mode === 'customize' && !['table', 'embed', 'stat', 'text', 'divider', 'image', 'slicer', 'filter'].includes(chartType) && onUpdateChartOption && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
            Legend / Series
          </Divider>
          <SelectField
            label="Series sort order"
            value={chartOptions?.legendSort || 'none'}
            onChange={(v) => onUpdateChartOption('legendSort', v === 'none' ? undefined : v)}
            options={[
              { label: 'Default (data order)', value: 'none' },
              { label: 'Descending (largest first)', value: 'desc' },
              { label: 'Ascending (smallest first)', value: 'asc' },
            ]}
            showSearch={false}
          />
          <InputField
            label="Max series shown"
            type="number"
            value={chartOptions?.legendLimit ?? ''}
            placeholder="All"
            onChange={(v) => onUpdateChartOption('legendLimit', v ? Math.max(1, parseInt(v, 10)) : undefined)}
          />
        </div>
      )}

      {/* Embed widget customize options (outside of 'customize !== table' guard) */}
      {mode === 'customize' && chartType === 'embed' && onUpdateChartOption && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 12, margin: '8px 0 4px' }}>
            Embed / iframe
          </Divider>
          <InputField
            label="URL"
            value={chartOptions?.url || ''}
            placeholder="https://…"
            onChange={(v) => onUpdateChartOption('url', v)}
          />
          <InputField
            label="Frame title (accessibility)"
            value={chartOptions?.frameTitle || ''}
            placeholder="Embedded content"
            onChange={(v) => onUpdateChartOption('frameTitle', v)}
          />
          <CheckboxField
            label="Allow scrolling"
            checked={chartOptions?.allowScrolling !== false}
            onChange={(v) => onUpdateChartOption('allowScrolling', v)}
          />
          <InputField
            label="Corner radius (px)"
            type="number"
            value={chartOptions?.borderRadius ?? 0}
            placeholder="0"
            onChange={(v) => onUpdateChartOption('borderRadius', Number(v) || 0)}
          />
        </div>
      )}

      {mode === 'colors' && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {onUpdateChartOption && (
            <>
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
                  label="Primary Color"
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

          <Divider className="panel-divider" style={{ margin: '16px 0' }} />

          <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SelectField
              label={t('drill_path')}
              value={chartQuery.drillPath || []}
              onChange={(val) => onUpdateChartQuery('drillPath', val || [])}
              options={selectedTableColumns}
              mode="multiple"
              placeholder={t('drill_path_placeholder')}
            />
            {(chartQuery.drillPath?.length ?? 0) > 0 && (
              <SelectField
                label={t('interaction_mode')}
                value={chartQuery.interactionMode || 'drill'}
                onChange={(val) => onUpdateChartQuery('interactionMode', val)}
                options={[
                  { label: t('interaction_drill'), value: 'drill' },
                  { label: t('interaction_cross_filter'), value: 'cross_filter' },
                ]}
                showSearch={false}
              />
            )}
            {(chartQuery.drillPath?.length ?? 0) > 0 && (
              <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                {t('drill_shift_hint')}
              </span>
            )}
          </div>

          {dashboardPages.length > 1 && (
            <>
              <Divider className="panel-divider" style={{ margin: '16px 0' }} />
              <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SelectField
                  label={t('drill_through_target_page')}
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
                  <>
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
                    <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                      {t('drill_through_hint')}
                    </span>
                  </>
                ) : null}
              </div>
            </>
          )}

          <Divider className="panel-divider" style={{ margin: '16px 0' }} />

          <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <RelatedJoinsPicker
              dataSourceId={selectedWidget.dataSourceId}
              baseTable={chartQuery.tableName}
              joins={chartQuery.joins || []}
              onChange={(joins) => onUpdateChartQuery('joins', joins)}
            />
          </div>

          <Divider className="panel-divider" style={{ margin: '16px 0' }} />

          {config.fields.filter(f => f.key.toLowerCase().includes('filter')).map((field) => {
            if (field.conditionalRender && !field.conditionalRender(chartQuery, chartOptions)) {
              return null;
            }

            switch (field.type) {
              case 'filter-list':
                return (
                  <FilterListField
                    key={field.key}
                    label={field.label}
                    hint={resolvePropertyFieldHint(field.key, t)}
                    required={field.required}
                    filters={chartQuery[field.key] || []}
                    onChange={(val) => onUpdateChartQuery(field.key, val)}
                    onFieldDrop={(droppedField) => onFieldDrop?.(field.key, droppedField)}
                    columnOptions={selectedTableColumns}
                    isLoading={isLoading}
                  />
                );

              case 'metric-filter-list': {
                const currentMetrics = [
                  ...(chartQuery.yMetrics || []),
                  ...(chartQuery.yMetricsSecondary || []),
                  ...(chartQuery.xMetrics || []),
                ];
                
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
                    hint={resolvePropertyFieldHint(field.key, t)}
                    label={field.label}
                    required={field.required}
                    filters={chartQuery[field.key] || []}
                    onChange={(val) => onUpdateChartQuery(field.key, val)}
                    metricOptions={metricOptions}
                    isLoading={isLoading}
                    placeholder="Add metric-based filters"
                  />
                );
              }
              default:
                return null;
            }
          })}
        </>
      )}
    </>
  );
};
