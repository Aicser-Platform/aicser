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
  mode?: 'mapping' | 'customize' | 'colors' | 'advanced';
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
  mode = 'mapping',
}) => {
  const t = useTranslations('chart_specific_fields');
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
                required={field.required}
                value={chartQuery[field.key] || undefined}
                onChange={(val) => onUpdateChartQuery(field.key, val)}
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
                required={field.required}
                metrics={chartQuery[field.key] || []}
                onChange={(val) => onUpdateChartQuery(field.key, val)}
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

      {mode === 'customize' && (
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

          {(chartType === 'pie' || chartType === 'donut') && onUpdateChartOption && (
            <SelectField
              label="Donut hole (%)"
              value={chartOptions?.innerRadius ?? (chartType === 'donut' ? 40 : 0)}
              onChange={(value) => onUpdateChartOption('innerRadius', value)}
              options={[0, 10, 20, 30, 40, 50, 60, 70, 80].map((v) => ({ label: `${v}%`, value: v }))}
              showSearch={false}
            />
          )}
        </div>
      )}

      {mode === 'colors' && (
        <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {onUpdateChartOption && (
            <>
              <ColorPaletteField
                label="Color Palette"
                value={chartOptions?.colorPalette || 'default'}
                chartOptions={chartOptions}
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
              label="Sort By"
              value={chartQuery.sortBy === 'record_order' ? undefined : chartQuery.sortBy}
              onChange={(val) => onUpdateChartQuery('sortBy', val || 'record_order')}
              options={dynamicSortOptions}
              placeholder="Default order"
              showSearch={false}
            />

            {chartQuery.sortBy && chartQuery.sortBy !== 'record_order' && (
              <div style={{ marginTop: -8, marginBottom: 8 }}>
                <CheckboxField 
                  label="Sort Ascending" 
                  checked={chartQuery.sortOrder === 'asc'} 
                  onChange={(checked) => onUpdateChartQuery('sortOrder', checked ? 'asc' : 'desc')} 
                />
              </div>
            )}

            <InputField
              label="Row Limit"
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
                    required={field.required}
                    filters={chartQuery[field.key] || []}
                    onChange={(val) => onUpdateChartQuery(field.key, val)}
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
