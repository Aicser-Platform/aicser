/**
 * Builds complete ECharts options configuration
 * Combines all configuration pieces into a complete chart option
 */
import {
  ChartConfig,
  ChartData,
  CHART_COLORS,
  DEFAULT_CHART_CONFIG,
  getBaseTooltipConfig,
  getBaseLegendConfig,
  getBaseGridConfig,
  getXAxisConfig,
  getYAxisConfig,
  getColorsFromPalette,
} from './WidgetRendererConfig';
import { buildSeriesForType } from './ChartSeriesBuilder';

export const buildChartOptions = (type: string, data: ChartData, config: Partial<ChartConfig> = {}): any => {
  const isDesigner = (config as any).isDesigner;
  // Merge with defaults
  const finalConfig: ChartConfig = { 
    ...DEFAULT_CHART_CONFIG, 
    ...config,
    // Automatically boost font sizes in designer mode if not explicitly set
    axisLabelFontSize: config.axisLabelFontSize ?? (isDesigner ? 12.5 : 11),
    legendFontSize: config.legendFontSize ?? (isDesigner ? 13.5 : 12),
    vAxisFontSize: config.vAxisFontSize ?? (isDesigner ? 12.5 : 11),
    hAxisFontSize: config.hAxisFontSize ?? (isDesigner ? 12.5 : 11),
  };

  // Auto-detect axis labels for scatter charts
  if (type === 'scatter') {
    if (!finalConfig.xAxisLabel && (data as any).xAxisLabel) finalConfig.xAxisLabel = (data as any).xAxisLabel;
    if (!finalConfig.yAxisLabel && (data as any).yAxisLabel) finalConfig.yAxisLabel = (data as any).yAxisLabel;

    if (data.series && data.series.length > 0) {
      const firstSeries = data.series[0];
      const seriesName = firstSeries?.name;
      if (seriesName && seriesName.includes(' vs ')) {
        const [xName, yName] = seriesName.split(' vs ');
        if (!finalConfig.xAxisLabel) finalConfig.xAxisLabel = xName;
        if (!finalConfig.yAxisLabel) finalConfig.yAxisLabel = yName;
      }
    }
  }

  // Calculate total number of categorical items to ensure unique colors
  const seriesCount = (data.series?.length || 0) + (data.secondarySeries?.length || 0);
  // If only one series, check if it's colored by data (like a single series bar chart)
  const isSingleSeriesCategorical = seriesCount <= 1 && data.x && data.x.length > 0 && ['bar', 'pie', 'donut', 'funnel', 'scatter'].includes(type);
  const colorCount = isSingleSeriesCategorical ? data.x.length : Math.max(seriesCount, 1);

  // Get colors from palette if specified, otherwise use default
  let chartColors = (config as any).colorPalette
    ? getColorsFromPalette((config as any).colorPalette, colorCount)
    : getColorsFromPalette('default', colorCount);

  // If many categories (e.g. 10+), push them into a more diverse spectrum if not using specialized palette
  if (colorCount > 8 && !(config as any).colorPalette) {
    chartColors = getColorsFromPalette('spectrum', colorCount);
  }

  // If a custom generated palette is picked, use it
  if (
    (config as any).customPalette &&
    Array.isArray((config as any).customPalette) &&
    (config as any).customPalette.length > 0
  ) {
    chartColors = (config as any).customPalette;
  } else if ((config as any).customColor) {
    // Fallback to primary color injection
    const custom = (config as any).customColor;
    chartColors = [custom, ...chartColors.filter((c) => c !== custom)];
  }

  // Enhanced tooltip with better number formatting
  let tooltipConfig: any = getBaseTooltipConfig(type);
  const isPercentStacked =
    (type === 'bar' && finalConfig.barStackMode === 'stacked-100') ||
    ((type === 'line' || type === 'area') && finalConfig.lineStackMode === 'stacked-100');

  if (type === 'pie' || type === 'donut') {
    // Calculate total for percentage
    const total = (data?.y || []).reduce((sum: number, val: number) => sum + (val || 0), 0);
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        const percentage = total > 0 ? ((params.value / total) * 100).toFixed(2) : '0.00';
        // Show raw value in tooltip for precision
        const rawValue = typeof params.value === 'number' ? params.value.toLocaleString() : params.value;
        return `<strong>${params.name}</strong><br/>${rawValue} (${percentage}%)`;
      },
    };
  } else if (type === 'scatter') {
    tooltipConfig = {
      ...tooltipConfig,
      trigger: 'item',
      formatter: (params: any) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!item || !item.data) return '';

        const xVal = item.data[0];
        const yVal = item.data[1];
        const xLabel = finalConfig.xAxisLabel || 'X';
        const yLabel = finalConfig.yAxisLabel || 'Y';
        const xStr = typeof xVal === 'number' ? xVal.toLocaleString() : (xVal ?? '');
        const yStr = typeof yVal === 'number' ? yVal.toLocaleString() : (yVal ?? '');

        return `<strong>${item.seriesName || ''}</strong><br/>
                ${xLabel}: ${xStr}<br/>
                ${yLabel}: ${yStr}`;
      },
    };
  } else if (isPercentStacked) {
    // Enhanced tooltip for 100% stacked charts - show both percentage and raw values
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        if (Array.isArray(params) && params.length > 0) {
          // Multiple series for stacked charts
          let tooltip = `<strong>${params[0].name || ''}</strong><br/>`;
          // Calculate totals for percentage calculation from original raw data
          const seriesData = data.series || [];
          const dataIndex = params[0].dataIndex;
          const rawTotal = seriesData.reduce((sum, series) => {
            const val = series.data?.[dataIndex] || 0;
            return sum + (typeof val === 'number' ? val : 0);
          }, 0);

          params.forEach((param: any) => {
            const rawValue = seriesData.find((s) => s.name === param.seriesName)?.data?.[dataIndex] || 0;
            const percentage = rawTotal > 0 ? ((rawValue / rawTotal) * 100).toFixed(2) : '0.00';
            const formattedRawValue = typeof rawValue === 'number' ? rawValue.toLocaleString() : rawValue;
            tooltip += `${param.marker || ''} ${param.seriesName || ''}: ${formattedRawValue} (${percentage}%)<br/>`;
          });

          // Add total line for better context
          const formattedTotal = typeof rawTotal === 'number' ? rawTotal.toLocaleString() : rawTotal;
          tooltip += `<br/><strong>Total: ${formattedTotal}</strong>`;
          return tooltip;
        } else if (params && !Array.isArray(params)) {
          // Single series
          const displayValue = typeof params.value === 'number' ? params.value.toFixed(2) : (params.value ?? '');
          return `<strong>${params.name || ''}</strong><br/>${params.marker || ''} ${params.seriesName || ''}: ${displayValue}%`;
        }
        return '';
      },
    };
  } else {
    // Enhanced tooltip for other chart types - show raw values
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        if (Array.isArray(params) && params.length > 0) {
          // Multiple series
          let tooltip = `<strong>${params[0].name || ''}</strong><br/>`;
          params.forEach((param: any) => {
            const rawValue = typeof param.value === 'number' ? param.value.toLocaleString() : (param.value ?? '');
            tooltip += `${param.marker || ''} ${param.seriesName || ''}: ${rawValue}<br/>`;
          });
          return tooltip;
        } else if (params && !Array.isArray(params)) {
          // Single series
          const rawValue = typeof params.value === 'number' ? params.value.toLocaleString() : (params.value ?? '');
          return `<strong>${params.name || ''}</strong><br/>${params.marker || ''} ${params.seriesName || ''}: ${rawValue}`;
        }
        return '';
      },
    };
  }

  const series = buildSeriesForType(type, data, finalConfig, chartColors);
  const seriesArray = Array.isArray(series) ? series : [series];

  // Refine scatter tooltip based on number of series
  if (type === 'scatter') {
    const showSeriesName = seriesArray.length > 1;
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!item || !item.data) return '';

        const xVal = item.data[0];
        const yVal = item.data[1];
        const xLabel = finalConfig.xAxisLabel || 'X';
        const yLabel = finalConfig.yAxisLabel || 'Y';
        const xStr = typeof xVal === 'number' ? xVal.toLocaleString() : (xVal ?? '');
        const yStr = typeof yVal === 'number' ? yVal.toLocaleString() : (yVal ?? '');

        const seriesHeader = showSeriesName ? `<strong>${item.seriesName || ''}</strong><br/>` : '';
        return `${seriesHeader}${xLabel}: ${xStr}<br/>${yLabel}: ${yStr}`;
      },
    };
  }

  const baseOptions: any = {
    animation: true,
    backgroundColor: finalConfig.backgroundColor || 'transparent',
    color: chartColors, // Use the selected palette colors
    tooltip: tooltipConfig,
    legend: getBaseLegendConfig(
      (finalConfig.showLegend ?? true) && (type !== 'scatter' || seriesArray.length > 1),
      type,
      finalConfig
    ),
    series: seriesArray,
  };

  const nonCartesianTypes = ['pie', 'donut', 'funnel', 'heatmap'];
  if (!nonCartesianTypes.includes(type)) {
    baseOptions.grid = getBaseGridConfig(finalConfig, data);

    // Special handling for 100% stacked charts (both bar and line charts)
    const isPercentStacked =
      (type === 'bar' && finalConfig.barStackMode === 'stacked-100') ||
      ((type === 'line' || type === 'area') && finalConfig.lineStackMode === 'stacked-100');
    const isHorizontalBar = type === 'bar' && finalConfig.barChartType === 'horizontal';

    // Configure X-axis with percentage support for horizontal stacked charts
    baseOptions.xAxis = [
      {
        ...getXAxisConfig(data, finalConfig, type),
      },
    ];

    // Support dual Y-axes if secondary series exist (including area charts)
    const hasSecondary = data.secondarySeries && data.secondarySeries.length > 0;
    // const isHorizontalBar = type === 'bar' && finalConfig.barChartType === 'horizontal';

    if (hasSecondary) {
      // For bar charts, only show Y-axis labels for combo-line type
      const shouldShowYAxisLabels =
        type === 'bar'
          ? finalConfig.showYAxisLegend && finalConfig.barChartType === 'combo-line'
          : finalConfig.showYAxisLegend;

      const primaryName = shouldShowYAxisLabels ? (config.yAxisLabel !== undefined ? config.yAxisLabel : data.series?.[0]?.name || '') : '';
      const secondaryName = shouldShowYAxisLabels ? (config.yAxisSecondaryLabel !== undefined ? config.yAxisSecondaryLabel : data.secondarySeries?.[0]?.name || '') : '';

      // For horizontal bar charts, avoid duplicate category axes on both sides
      if (isHorizontalBar && finalConfig.barChartType !== 'combo-line') {
        // Only use single Y-axis for horizontal bar charts (unless it's combo-line)
        baseOptions.yAxis = [
          {
            ...getYAxisConfig(finalConfig, data),
            name: primaryName,
          },
        ];
      } else {
        baseOptions.yAxis = [
          {
            ...getYAxisConfig(finalConfig, data),
            name: primaryName,
          },
          {
            ...getYAxisConfig(finalConfig, data),
            name: secondaryName,
            position: 'right',
            splitLine: { show: false },
            // For horizontal bar combo-line, secondary axis should be value type (for lines)
            // For 100% stacked charts, both axes should have 0-100 range
            ...(isHorizontalBar && finalConfig.barChartType === 'combo-line' ? { type: 'value', data: undefined } : {}),
            ...(isPercentStacked && !isHorizontalBar
              ? {
                  min: 0,
                  max: 100,
                }
              : {}),
          },
        ];
      }
    } else {
      baseOptions.yAxis = [
        {
          ...getYAxisConfig(finalConfig, data),
        },
      ];
    }
  } else if (type === 'heatmap') {
    // ... heatmap config ...
    const xLabels = Array.from(new Set((data.x || []).map(String)));
    const yLabels = Array.from(new Set((data.group_field || ['Value']).map(String)));

    baseOptions.grid = getBaseGridConfig(finalConfig, data);
    baseOptions.xAxis = [
      {
        type: 'category',
        data: xLabels,
        splitArea: { show: true },
        axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 11 },
      },
    ];
    baseOptions.yAxis = [
      {
        type: 'category',
        data: yLabels,
        splitArea: { show: true },
        axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 11 },
      },
    ];
    baseOptions.visualMap = {
      min: Math.min(...(data.y || [0])),
      max: Math.max(...(data.y || [100])),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '5%',
      inRange: {
        color: ['#e0f3f8', CHART_COLORS.primary, '#004a4d'],
      },
    };
  }

  return baseOptions;
};
