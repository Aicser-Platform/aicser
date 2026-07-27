import React from 'react';
import { CheckboxField } from './FormFields';
import { PpLabel } from './PpLabel';
import { DEFAULT_CHART_CONFIG } from '../widgets/WidgetRendererConfig';
import { useTranslations } from 'next-intl';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';

interface ChartOptionsProps {
  chartType: string;
  chartOptions: any;
  chartQuery: any;
  onUpdateChartOption: (key: string, value: any) => void;
  onUpdateChartOptions?: (updates: Record<string, any>) => void;
}

/**
 * Chart display toggles (legend, data labels, grid, axes).
 * Gated per type via widgetPropertyProfile so content/KPI/map etc. stay clean.
 */
export const ChartOptions: React.FC<ChartOptionsProps> = ({
  chartType,
  chartOptions,
  chartQuery,
  onUpdateChartOption,
  onUpdateChartOptions,
}) => {
  const t = useTranslations('chart_options');
  const profile = getWidgetPropertyProfile(chartType);
  const hasSecondaryAxis = chartQuery?.yMetricsSecondary?.length > 0;

  const shouldShowYAxisLegend =
    chartType === 'bar'
      ? hasSecondaryAxis && chartOptions?.barChartType === 'combo-line'
      : chartType === 'area'
        ? false
        : hasSecondaryAxis && profile.showCartesianAxes;

  const patch = (updates: Record<string, any>) => {
    if (onUpdateChartOptions) {
      onUpdateChartOptions(updates);
      return;
    }
    Object.entries(updates).forEach(([key, value]) => onUpdateChartOption(key, value));
  };

  if (!profile.showLegendToggle && !profile.showDataLabelToggle && !profile.showCartesianAxes) {
    return null;
  }

  const showDataLabel =
    chartOptions.showDataLabel !== undefined
      ? !!chartOptions.showDataLabel
      : !!DEFAULT_CHART_CONFIG.showDataLabel;

  const showXAxis =
    chartOptions.showHAxisLabels !== undefined || chartOptions.showHAxisLine !== undefined
      ? (chartOptions.showHAxisLabels ?? chartOptions.showHAxisLine) !== false
      : chartOptions.showAxis !== undefined
        ? !!chartOptions.showAxis
        : !!DEFAULT_CHART_CONFIG.showAxis;

  const showYAxis =
    chartOptions.showVAxisLabels !== undefined
      ? chartOptions.showVAxisLabels !== false
      : chartOptions.showAxis !== undefined
        ? !!chartOptions.showAxis
        : !!DEFAULT_CHART_CONFIG.showAxis;

  const setXAxis = (checked: boolean) => {
    const yOn = showYAxis;
    patch({
      showHAxisLabels: checked,
      showHAxisLine: checked,
      showAxis: checked && yOn,
    });
  };

  const setYAxis = (checked: boolean) => {
    const xOn = showXAxis;
    patch({
      showVAxisLabels: checked,
      showAxis: checked && xOn,
    });
  };

  return (
    <div className="pp-format-section">
      <PpLabel>{t('options')}</PpLabel>
      <div className="pp-options-grid">
        {profile.showLegendToggle ? (
          <CheckboxField
            label={t('legend')}
            checked={
              chartOptions.showLegend !== undefined
                ? !!chartOptions.showLegend
                : !!DEFAULT_CHART_CONFIG.showLegend
            }
            onChange={(checked) => onUpdateChartOption('showLegend', checked)}
          />
        ) : null}
        {profile.showDataLabelToggle ? (
          <CheckboxField
            label={t('data_label')}
            checked={showDataLabel}
            onChange={(checked) => onUpdateChartOption('showDataLabel', checked)}
          />
        ) : null}
        {profile.showCartesianAxes ? (
          <>
            <CheckboxField
              label={t('gridline')}
              checked={
                chartOptions.showGridline !== undefined
                  ? !!chartOptions.showGridline
                  : !!DEFAULT_CHART_CONFIG.showGridline
              }
              onChange={(checked) => onUpdateChartOption('showGridline', checked)}
            />
            <CheckboxField label={t('x_axis')} checked={showXAxis} onChange={setXAxis} />
            <CheckboxField label={t('y_axis')} checked={showYAxis} onChange={setYAxis} />
          </>
        ) : null}
        {shouldShowYAxisLegend ? (
          <CheckboxField
            label={t('y_axis_legend')}
            checked={
              chartOptions.showYAxisLegend !== undefined
                ? !!chartOptions.showYAxisLegend
                : !!DEFAULT_CHART_CONFIG.showYAxisLegend
            }
            onChange={(checked) => onUpdateChartOption('showYAxisLegend', checked)}
          />
        ) : null}
      </div>
    </div>
  );
};
