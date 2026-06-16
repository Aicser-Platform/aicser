'use client';

import { WidgetInstance } from '../stores/useDashboardStore';
import { WidgetRenderer } from './WidgetRenderer';
import * as echarts from 'echarts';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { useDashboardStore } from '../stores/useDashboardStore';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';

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
  const dashboardDefaultPalette = useDashboardStore((s) => {
    const dash = s.dashboards.find((d) => d.id === s.activeDashboardId);
    return dash?.config?.default_color_palette as string | undefined;
  });

  const resolvedChartConfig = {
    ...(widget.chartOptions || {}),
    colorPalette: resolveChartPaletteId(
      widget.chartOptions?.colorPalette,
      dashboardDefaultPalette,
    ),
    dashboardDefaultPalette,
    ...(compactPreview
      ? {
          isDashboardWidget: true,
          isFeedPreview: true,
          axisLabelFontSize: 9,
          hAxisFontSize: 9,
          vAxisFontSize: 9,
          legendFontSize: 9,
          fontSize: widget.chartType === 'stat' ? 24 : widget.chartOptions?.fontSize,
          layout: widget.chartType === 'stat' ? 'compact' : widget.chartOptions?.layout,
        }
      : {}),
  };

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
