import React from 'react';
import { CheckboxField } from './FormFields';
import { CHART_OPTIONS_CONFIG } from './PropertiesPanelConfig';
import { DEFAULT_CHART_CONFIG } from '../widgets/WidgetRendererConfig';
import { useTranslations } from 'next-intl';

interface ChartOptionsProps {
  chartType: string;
  chartOptions: any;
  chartQuery: any;
  onUpdateChartOption: (key: string, value: boolean) => void;
}

/**
 * Renders chart display options (legend, gridlines, etc.)
 * Automatically determines which options are available based on chart type
 */
export const ChartOptions: React.FC<ChartOptionsProps> = ({
  chartType,
  chartOptions,
  chartQuery,
  onUpdateChartOption,
}) => {
  const t = useTranslations('chart_options');
  const hasSecondaryAxis = chartQuery?.yMetricsSecondary?.length > 0;

  // For bar charts: only show Y-axis legend for combo-line type (dual axes)
  // For vertical/horizontal and area charts: never show Y-axis legend (single axis)
  const shouldShowYAxisLegend =
    chartType === 'bar' ? hasSecondaryAxis && chartOptions?.barChartType === 'combo-line' : 
    chartType === 'area' ? false : hasSecondaryAxis;

  const availableOptions = [
    ...CHART_OPTIONS_CONFIG.all.filter(opt => opt !== 'showLegend'),
    ...(chartType !== 'pie' && chartType !== 'donut' ? CHART_OPTIONS_CONFIG.nonPie : []),
    ...(shouldShowYAxisLegend ? CHART_OPTIONS_CONFIG.secondaryAxis : []),
    ...(chartType === 'bar' ? CHART_OPTIONS_CONFIG.bar : []), // Add bar-specific options
  ];

  const optionLabels: Record<string, string> = {
    showLegend: t('legend'),
    showDataLabel: t('data_label'),
    showGridline: t('gridline'),
    showAxis: t('axis'),
    showYAxisLegend: t('y_axis_legend'),
    barChartType: t('chart_type'),
    stacked: t('stacked'),
  };

  return (
    <div className="panel-section" style={{ paddingBottom: 35 }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#1f2329' }}>{t('options')}</span>
      </div>
      <div className="options-grid">
        {availableOptions.map((optionKey) => {
          const isChecked =
            chartOptions[optionKey] !== undefined
              ? chartOptions[optionKey]
              : DEFAULT_CHART_CONFIG[optionKey as keyof typeof DEFAULT_CHART_CONFIG];

          // Skip non-boolean options as they're handled elsewhere
          if (optionKey === 'barChartType' || optionKey === 'barStackMode') {
          }

          return (
            <CheckboxField
              key={optionKey}
              label={optionLabels[optionKey] || optionKey}
              checked={!!isChecked}
              onChange={(checked) => onUpdateChartOption(optionKey, checked)}
            />
          );
        })}
      </div>
    </div>
  );
};
