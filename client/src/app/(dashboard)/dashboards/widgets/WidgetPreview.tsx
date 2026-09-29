'use client';

import React, { useMemo } from 'react';
import { WidgetInstance } from '../stores/useDashboardStore';
import { WidgetRenderer } from './WidgetRenderer';
import * as echarts from 'echarts';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { effectiveWidgetPalette, resolveChartPaletteId } from '../utils/chartPaletteCatalog';
import { useDashboardPalette } from './DashboardPaletteContext';
import { useTranslations } from 'next-intl';

export const WidgetPreview: React.FC<{
  widget: WidgetInstance;
  onChartReady?: (instance: echarts.ECharts) => void;
  onUpdateConfig?: (updates: any) => void;
  readOnly?: boolean;
  minHeight?: number;
  isDesigner?: boolean;
  isSelected?: boolean;
  dashboardId?: string;
  runtimeFilters?: RuntimeFilter[];
  onFilter?: (field: string, value: unknown) => void;
  compactPreview?: boolean;
}> = ({
  widget,
  onChartReady,
  onUpdateConfig,
  readOnly = false,
  minHeight,
  isDesigner = false,
  isSelected = false,
  dashboardId,
  runtimeFilters = [],
  onFilter,
  compactPreview = false,
}) => {
  // The palette of the dashboard this widget is drawn in (provided per surface), never the
  // studio's active dashboard: that leaked one dashboard's theme into feed posts and viewers.
  const dashboardDefaultPalette = useDashboardPalette();
  const tCommon = useTranslations('common');
  const booleanLabels = useMemo(() => ({ yes: tCommon('yes'), no: tCommon('no') }), [tCommon]);
  const otherLabel = tCommon('other');
  const tDash = useTranslations('dashboards');
  // Words the extended charts draw themselves (waterfall Total, bullet Target, funnel shares…).
  const chartText = useMemo(
    () => ({
      increase: tDash('chart_increase'),
      decrease: tDash('chart_decrease'),
      total: tDash('chart_total'),
      actual: tDash('chart_actual'),
      target: tDash('chart_target'),
      count: tDash('chart_count'),
      ofTop: tDash('chart_of_top', { pct: '{pct}' }),
      ofPrevious: tDash('chart_of_previous', { pct: '{pct}' }),
      ofTotal: tDash('chart_of_total', { pct: '{pct}' }),
      rows: tDash('chart_rows', { count: '{count}' }),
    }),
    [tDash],
  );

  const resolvedChartConfig = useMemo(() => {
    const options = widget.chartOptions || {};
    // An older chat pin saved the chat's default colours as "custom": treat it as that palette
    // and drop the leftover overrides, so it follows the dashboard's theme like other charts.
    const legacyChatPalette =
      options.colorPalette === 'custom' && effectiveWidgetPalette(options) !== 'custom';
    return {
      ...options,
      ...(legacyChatPalette ? { customPalette: undefined, customColor: undefined } : {}),
      title: options.title || widget.title,
      colorPalette: resolveChartPaletteId(effectiveWidgetPalette(options), dashboardDefaultPalette),
      // A palette was actually chosen (on the chart or its dashboard), so it should win over
      // colours frozen into a saved ECharts snapshot.
      __paletteChosen: Boolean(effectiveWidgetPalette(options) || dashboardDefaultPalette),
      __booleanLabels: booleanLabels,
      __otherLabel: otherLabel,
      __chartText: chartText,
      dashboardDefaultPalette,
      __widgetDataSourceId: widget.dataSourceId,
      ...(compactPreview
        ? {
            isDashboardWidget: true,
            isFeedPreview: true,
            axisLabelFontSize: 9,
            hAxisFontSize: 9,
            vAxisFontSize: 9,
            legendFontSize: 9,
            fontSize: widget.chartType === 'stat' ? 24 : options.fontSize,
            // Keep author layout for stats — don't force compact and erase executive/tile/etc.
            layout: widget.chartType === 'stat' ? options.layout || 'compact' : options.layout,
          }
        : {}),
    };
  }, [
    widget.chartOptions,
    widget.title,
    widget.dataSourceId,
    widget.chartType,
    dashboardDefaultPalette,
    booleanLabels,
    otherLabel,
    chartText,
    compactPreview,
  ]);

  return (
    <WidgetRenderer
      type={widget.chartType}
      data={widget.chartData}
      config={resolvedChartConfig}
      query={{ ...widget.chartQuery, dataSourceId: widget.dataSourceId }}
      isLoading={widget.isLoading}
      error={widget.error}
      onChartReady={onChartReady}
      onUpdateConfig={onUpdateConfig}
      readOnly={readOnly}
      minHeight={minHeight}
      isDesigner={isDesigner}
      isSelected={isSelected}
      dashboardId={dashboardId}
      runtimeFilters={runtimeFilters}
      onFilter={onFilter}
    />
  );
};
