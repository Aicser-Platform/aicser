import React from 'react';
import { Checkbox, InputNumber, Slider } from 'antd';
import { legendPlacement } from '../widgets/WidgetRendererConfig';
import { CurrencySymbolField } from './CurrencySymbolField';
import { dataLabelPositionsFor } from '../widgets/dataLabelPosition';
import { CheckboxField, SelectField, InputField } from './FormFields';
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
 * Format → Labels (legend, data labels, number format) and Axes (per axis: values, title, angle,
 * scale; gridlines with Y). Gated per type via widgetPropertyProfile so content/KPI/map stay clean.
 */
const LEGEND_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;

/** Older charts saved a side ("top"); show it as the spot it renders at. */
function legendPlacementValue(position?: string): string {
  const { side, align } = legendPlacement(position || 'top');
  if (side === 'left' || side === 'right') return `middle-${side}`;
  return `${side}-${align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'}`;
}

export const ChartOptions: React.FC<ChartOptionsProps> = ({
  chartType,
  chartOptions,
  chartQuery,
  onUpdateChartOption,
  onUpdateChartOptions,
}) => {
  const t = useTranslations('chart_options');
  const profile = getWidgetPropertyProfile(chartType);
  // While dragging, the angle lives here; it is saved once on release.
  const [dragRotate, setDragRotate] = React.useState<number | null>(null);
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

  if (
    !profile.showLegendToggle &&
    !profile.showDataLabelToggle &&
    !profile.showCartesianAxes &&
    !profile.showValueFormat
  ) {
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

  const legendOn =
    chartOptions.showLegend !== undefined ? !!chartOptions.showLegend : !!DEFAULT_CHART_CONFIG.showLegend;
  // Label angle in degrees; older charts saved a named slant.
  const SLANT_DEG: Record<string, number> = { up: -90, down: 90, 'right-diagonal': 45, 'left-diagonal': -45 };
  const xRotate =
    typeof chartOptions.hAxisLabelRotate === 'number'
      ? chartOptions.hAxisLabelRotate
      : SLANT_DEG[String(chartOptions.hAxisLabelSlant)] ?? 0;
  const design = (chartOptions.design || {}) as Record<string, any>;
  const setDesign = (key: 'axis' | 'labels', value: Record<string, unknown>) =>
    patch({ design: { ...design, [key]: { ...(design[key] || {}), ...value } } });
  const isHorizontalBar = chartType === 'bar' && chartOptions.barChartType === 'horizontal';
  const valueFormat = chartOptions.valueFormat || 'auto';
  const scaleOptions = [
    { label: t('scale_linear'), value: 'linear' },
    { label: t('scale_log'), value: 'log' },
  ];

  return (
    <>
      <div className="pp-format-section">
        <PpLabel>{t('labels')}</PpLabel>
        <div className="pp-options-grid">
          {profile.showLegendToggle ? (
            <CheckboxField
              label={t('legend')}
              checked={legendOn}
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
        {profile.showLegendToggle && legendOn ? (
          <SelectField
            label={t('legend_position')}
            value={legendPlacementValue(chartOptions.legendPosition)}
            onChange={(v) => onUpdateChartOption('legendPosition', v)}
            options={LEGEND_POSITIONS.map((p) => ({ label: t(`legend_pos_${p.replace('-', '_')}`), value: p }))}
            showSearch={false}
          />
        ) : null}
        {showDataLabel && dataLabelPositionsFor(chartType).length > 0 ? (
          <SelectField
            label={t('data_label_position')}
            value={
              chartOptions.dataLabelPosition ||
              (chartType === 'bar' && design.labels?.valueOnBar ? 'inside' : dataLabelPositionsFor(chartType)[0])
            }
            options={dataLabelPositionsFor(chartType).map((p) => ({ label: t(`label_pos_${p}`), value: p }))}
            onChange={(v) =>
              patch({
                dataLabelPosition: v,
                // The position replaces the older "value on bar" style.
                ...(design.labels?.valueOnBar
                  ? { design: { ...design, labels: { ...design.labels, valueOnBar: false } } }
                  : {}),
              })
            }
            showSearch={false}
          />
        ) : null}
        {showDataLabel && (chartType === 'pie' || chartType === 'donut') ? (
          <div>
            <PpLabel>{t('label_shows')}</PpLabel>
            <Checkbox.Group
              className="pp-label-parts"
              value={chartOptions.pieLabelParts?.length ? chartOptions.pieLabelParts : ['name', 'value', 'percent']}
              options={[
                { label: t('label_part_name'), value: 'name' },
                { label: t('label_part_value'), value: 'value' },
                { label: t('label_part_percent'), value: 'percent' },
              ]}
              onChange={(v) => onUpdateChartOption('pieLabelParts', v.length === 3 || v.length === 0 ? undefined : v)}
            />
          </div>
        ) : null}
        {profile.showValueFormat ? (
          <>
            <SelectField
              label={t('number_format')}
              value={valueFormat}
              onChange={(v) => onUpdateChartOption('valueFormat', v === 'auto' ? undefined : v)}
              options={[
                { label: t('number_format_auto'), value: 'auto' },
                { label: t('number_format_full'), value: 'full' },
                { label: t('number_format_currency'), value: 'currency' },
                { label: t('number_format_percent'), value: 'percent' },
                // "Compact" read the same as Auto; kept only for charts already using it.
                ...(valueFormat === 'compact' ? [{ label: t('number_format_compact'), value: 'compact' }] : []),
              ]}
              showSearch={false}
            />
            {valueFormat === 'currency' ? (
              <CurrencySymbolField
                label={t('currency')}
                value={typeof chartOptions.currencySymbol === 'string' ? chartOptions.currencySymbol : ''}
                onChange={(v) => onUpdateChartOption('currencySymbol', v || undefined)}
              />
            ) : null}
            <SelectField
              label={t('decimals')}
              value={typeof chartOptions.valueDecimals === 'number' ? chartOptions.valueDecimals : 'auto'}
              onChange={(v) => onUpdateChartOption('valueDecimals', v === 'auto' ? undefined : Number(v))}
              options={[
                { label: t('decimals_auto'), value: 'auto' },
                { label: '0', value: 0 },
                { label: '1', value: 1 },
                { label: '2', value: 2 },
                { label: '3', value: 3 },
              ]}
              showSearch={false}
            />
          </>
        ) : null}
      </div>

      {profile.showCartesianAxes ? (
        <div className="pp-format-section pp-axes">
          {/* One block per axis (Power BI / Excel): its values, its title, its scale. */}
          <div className="pp-axis-block">
            <div className="pp-axis-heading">{t('x_axis')}</div>
            <CheckboxField label={t('axis_show_values')} checked={showXAxis} onChange={setXAxis} />
            <InputField
              label={t('axis_title')}
              value={chartOptions.xAxisLabel ?? ''}
              placeholder={t('axis_title_placeholder')}
              onChange={(v) => onUpdateChartOption('xAxisLabel', v || undefined)}
            />
            {showXAxis && !isHorizontalBar && chartType !== 'scatter' ? (
              <div>
                <PpLabel>{t('label_angle')}</PpLabel>
                <div className="pp-angle-row">
                  <Slider
                    min={-90}
                    max={90}
                    step={5}
                    value={dragRotate ?? xRotate}
                    marks={{ '-90': '-90°', 0: '0°', 45: '45°', 90: '90°' }}
                    tooltip={{ formatter: (v) => `${v}°` }}
                    onChange={(v) => setDragRotate(v)}
                    onChangeComplete={(v) => {
                      setDragRotate(null);
                      patch({ hAxisLabelRotate: v, hAxisLabelSlant: undefined });
                    }}
                  />
                  <InputNumber
                    size="small"
                    min={-90}
                    max={90}
                    value={xRotate}
                    formatter={(v) => `${v ?? 0}°`}
                    parser={(v) => Number(String(v ?? '').replace('°', '')) || 0}
                    aria-label={t('label_angle')}
                    onChange={(v) => patch({ hAxisLabelRotate: Number(v ?? 0), hAxisLabelSlant: undefined })}
                  />
                </div>
              </div>
            ) : null}
            {isHorizontalBar ? (
              <>
            {true ? (
              <div>
                <PpLabel tip={t('axis_range_tip')}>{t('axis_range')}</PpLabel>
                <div className="pp-range-row">
                  <InputNumber
                    size="small"
                    placeholder={t('axis_range_auto')}
                    aria-label={t('axis_range_start')}
                    addonBefore={t('axis_range_start')}
                    value={typeof chartOptions.valueAxisMin === 'number' ? chartOptions.valueAxisMin : null}
                    onChange={(v) => onUpdateChartOption('valueAxisMin', v === null ? undefined : Number(v))}
                  />
                  <InputNumber
                    size="small"
                    placeholder={t('axis_range_auto')}
                    aria-label={t('axis_range_end')}
                    addonBefore={t('axis_range_end')}
                    value={typeof chartOptions.valueAxisMax === 'number' ? chartOptions.valueAxisMax : null}
                    onChange={(v) => onUpdateChartOption('valueAxisMax', v === null ? undefined : Number(v))}
                  />
                </div>
              </div>
            ) : null}
              </>
            ) : null}
            {chartType === 'scatter' ? (
              <SelectField
                label={t('axis_scale')}
                hint={t('axis_scale_tip')}
                value={design.axis?.xScale || 'linear'}
                onChange={(v) => setDesign('axis', { xScale: v })}
                options={scaleOptions}
                showSearch={false}
              />
            ) : null}
          </div>
          <div className="pp-axis-block">
            <div className="pp-axis-heading">{t('y_axis')}</div>
            <CheckboxField label={t('axis_show_values')} checked={showYAxis} onChange={setYAxis} />
            <InputField
              label={t('axis_title')}
              value={chartOptions.yAxisLabel ?? ''}
              placeholder={t('axis_title_placeholder')}
              onChange={(v) => onUpdateChartOption('yAxisLabel', v || undefined)}
            />
            {!isHorizontalBar ? (
              <>
            {chartType !== 'scatter' ? (
              <div>
                <PpLabel tip={t('axis_range_tip')}>{t('axis_range')}</PpLabel>
                <div className="pp-range-row">
                  <InputNumber
                    size="small"
                    placeholder={t('axis_range_auto')}
                    aria-label={t('axis_range_start')}
                    addonBefore={t('axis_range_start')}
                    value={typeof chartOptions.valueAxisMin === 'number' ? chartOptions.valueAxisMin : null}
                    onChange={(v) => onUpdateChartOption('valueAxisMin', v === null ? undefined : Number(v))}
                  />
                  <InputNumber
                    size="small"
                    placeholder={t('axis_range_auto')}
                    aria-label={t('axis_range_end')}
                    addonBefore={t('axis_range_end')}
                    value={typeof chartOptions.valueAxisMax === 'number' ? chartOptions.valueAxisMax : null}
                    onChange={(v) => onUpdateChartOption('valueAxisMax', v === null ? undefined : Number(v))}
                  />
                </div>
              </div>
            ) : null}
              </>
            ) : null}
            {/* No log scale on bars: their length is read from zero. */}
            {chartType !== 'bar' ? (
              <SelectField
                label={t('axis_scale')}
                hint={t('axis_scale_tip')}
                value={design.axis?.yScale || 'linear'}
                onChange={(v) => setDesign('axis', { yScale: v })}
                options={scaleOptions}
                showSearch={false}
              />
            ) : null}
            <CheckboxField
              label={t('gridline')}
              checked={
                chartOptions.showGridline !== undefined
                  ? !!chartOptions.showGridline
                  : !!DEFAULT_CHART_CONFIG.showGridline
              }
              onChange={(checked) => onUpdateChartOption('showGridline', checked)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
};
