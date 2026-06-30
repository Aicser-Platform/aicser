/**
 * Builds ECharts series configurations for different chart types
 * Makes it easy to add new chart types or modify existing ones
 */

import * as echarts from 'echarts';
import { ChartConfig, ChartData, CHART_COLORS, getCartesianEmphasis, getCartesianBlur } from './WidgetRendererConfig';
import { formatNumber } from '../utils/numberFormatter';
import { getPieLayout, getChartSliceBorderColor } from './chartLayoutUtils';

// Helper to convert hex color to rgba
const hexToRgba = (hex: string, alpha: number): string => {
  const hStr = hex.startsWith('#') ? hex.slice(1) : hex;
  let r = 0,
    g = 0,
    b = 0;

  if (hStr.length === 3) {
    r = parseInt(hStr[0] + hStr[0], 16);
    g = parseInt(hStr[1] + hStr[1], 16);
    b = parseInt(hStr[2] + hStr[2], 16);
  } else if (hStr.length >= 6) {
    r = parseInt(hStr.slice(0, 2), 16);
    g = parseInt(hStr.slice(2, 4), 16);
    b = parseInt(hStr.slice(4, 6), 16);
  } else {
    return `rgba(0, 194, 203, ${alpha})`; // fallback
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Helper to determine line style based on config
const getLineStyleConfig = (config: ChartConfig) => {
  const lineType = config.lineChartType || 'line';
  switch (lineType) {
    case 'smooth':
      return { smooth: 0.4, step: false };
    case 'step':
      return { smooth: false, step: 'middle' as const };
    case 'line':
    default:
      return { smooth: false, step: false };
  }
};

export const buildBarSeries = (data: ChartData, config: ChartConfig, colors?: string[]) => {
  // If primary series is empty but secondary has data, treat secondary as primary.
  // This handles stale yMetricsSecondary DB state after General-tab Apply Changes.
  const effectiveData: ChartData = (!data.series?.length && data.secondarySeries?.length)
    ? { ...data, series: data.secondarySeries, secondarySeries: [] }
    : data;

  const seriesColors = colors || CHART_COLORS.secondary;
  const isHorizontalBar = config.barChartType === 'horizontal';
  const isComboLine = config.barChartType === 'combo-line';
  const isStackedBar = config.barStackMode === 'stacked' || config.barStackMode === 'stacked-100';
  const isPercentStacked = config.barStackMode === 'stacked-100';

  // Helper function to convert data to percentages for 100% stacked charts
  const convertToPercent = (seriesData: any[], allSeries: any[]) => {
    if (!isPercentStacked || !Array.isArray(seriesData) || allSeries.length <= 1) return seriesData;

    return seriesData.map((value, index) => {
      const total = allSeries.reduce((sum, series) => {
        const seriesValue = Array.isArray(series.data) ? series.data[index] : 0;
        return sum + (typeof seriesValue === 'number' ? seriesValue : 0);
      }, 0);

      return total > 0 ? (value / total) * 100 : 0;
    });
  };

  if ((effectiveData.series && effectiveData.series.length > 0) || (effectiveData.secondarySeries && effectiveData.secondarySeries.length > 0)) {
    const allSeries = [...(effectiveData.series || []), ...(effectiveData.secondarySeries || [])];

    const primarySeries = (effectiveData.series || []).map((s, index) => ({
      name: s.name,
      type: 'bar',
      colorBy: allSeries.length === 1 ? 'data' : 'series',
      stack: isStackedBar ? 'total' : undefined,
      barGap: isStackedBar ? '20%' : '10%', // More space for stacked charts
      label: {
        show: config.showDataLabel,
        position: isHorizontalBar ? 'inside' : 'top', // Inside positioning for better readability in stacked charts
        formatter: isPercentStacked
          ? (params: any) => {
              const value = typeof params.value === 'number' ? params.value : 0;
              // Only show label if segment is large enough (>5%)
              return value > 5 ? `${value.toFixed(2)}%` : '';
            }
          : undefined,
        fontSize: config.axisLabelFontSize ?? 11,
        color: isStackedBar
          ? '#fff'
          : config.axisLabelColor === 'default'
            ? CHART_COLORS.text.primary
            : (config.axisLabelColor ?? CHART_COLORS.text.primary),
        fontWeight: isStackedBar ? 'bold' : 'normal',
      },
      itemStyle: {
        borderRadius: isStackedBar ? [0, 0, 0, 0] : 4, // No border radius for stacked to avoid gaps
        borderWidth: isStackedBar ? 1 : 0,
        borderColor: CHART_COLORS.background,
      },
      emphasis: getCartesianEmphasis('bar'),
      blur: getCartesianBlur(),
      data: isPercentStacked ? convertToPercent(s.data, allSeries) : s.data,
      yAxisIndex: 0,
    }));

    // Only add secondary series as line charts for combo-line type
    const secondarySeries = isComboLine
      ? (effectiveData.secondarySeries || []).map((s) => {
          // Use shared line config logic
          const lineConfig = getLineStyleConfig(config);

          return {
            name: s.name,
            type: 'line',
            smooth: lineConfig.smooth,
            step: lineConfig.step,
            showSymbol: config.showPoints,
            symbolSize: config.symbolSize ?? 8,
            lineStyle: { width: config.lineWidth ?? 3 },
            label: {
              show: config.showDataLabel,
              position: 'top',
              color:
                config.axisLabelColor === 'default'
                  ? CHART_COLORS.text.primary
                  : (config.axisLabelColor ?? CHART_COLORS.text.primary),
              fontSize: config.axisLabelFontSize ?? 11,
            },
            data: s.data,
            yAxisIndex: 1,
          };
        })
      : [];

    return [...primarySeries, ...secondarySeries];
  }

  return {
    name: 'Value',
    type: 'bar',
    colorBy: 'data',
    stack: isStackedBar ? 'total' : undefined,
    barWidth: isStackedBar ? '60%' : '40%', // Wider bars for stacked charts
    label: {
      show: config.showDataLabel,
      position: isHorizontalBar ? 'inside' : 'top',
      formatter: isPercentStacked
        ? (params: any) => {
            const value = typeof params.value === 'number' ? params.value : 0;
            return `${value.toFixed(2)}%`;
          }
        : undefined,
      fontSize: config.axisLabelFontSize ?? 11,
      color: isStackedBar
        ? '#fff'
        : config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
      fontWeight: isStackedBar ? 'bold' : 'normal',
    },
    data: data?.y || [],
    itemStyle: {
      borderRadius: isStackedBar ? [0, 0, 0, 0] : 4,
      borderWidth: isStackedBar ? 1 : 0,
      borderColor: CHART_COLORS.background,
    },
    emphasis: getCartesianEmphasis('bar'),
    blur: getCartesianBlur(),
  };
};

export const buildLineSeries = (data: ChartData, config: ChartConfig, colors?: string[]) => {
  // If primary series is empty but secondary has data, treat secondary as primary.
  // This handles stale yMetricsSecondary DB state after General-tab Apply Changes.
  const effectiveData: ChartData = (!data.series?.length && data.secondarySeries?.length)
    ? { ...data, series: data.secondarySeries, secondarySeries: [] }
    : data;

  // Use shared line config
  const lineConfig = getLineStyleConfig(config);
  const isStackedLine = config.lineStackMode === 'stacked' || config.lineStackMode === 'stacked-100';
  const isPercentStacked = config.lineStackMode === 'stacked-100';

  // Helper function to convert data to percentages for 100% stacked charts
  const convertToPercent = (seriesData: any[], allSeries: any[]) => {
    if (!isPercentStacked || !Array.isArray(seriesData) || allSeries.length <= 1) return seriesData;

    return seriesData.map((value, index) => {
      const total = allSeries.reduce((sum, series) => {
        const seriesValue = Array.isArray(series.data) ? series.data[index] : 0;
        return sum + (typeof seriesValue === 'number' ? seriesValue : 0);
      }, 0);

      return total > 0 ? (value / total) * 100 : 0;
    });
  };

  if ((effectiveData.series && effectiveData.series.length > 0) || (effectiveData.secondarySeries && effectiveData.secondarySeries.length > 0)) {
    const allSeries = [...(effectiveData.series || []), ...(effectiveData.secondarySeries || [])];

    const primarySeries = (effectiveData.series || []).map((s) => ({
      name: s.name,
      type: 'line',
      smooth: lineConfig.smooth,
      step: lineConfig.step,
      showSymbol: config.showPoints,
      symbolSize: config.symbolSize ?? 8,
      lineStyle: { width: config.lineWidth ?? 3 },
      stack: isStackedLine ? 'total' : undefined,
      label: {
        show: config.showDataLabel,
        position: 'top',
        color:
          config.axisLabelColor === 'default'
            ? CHART_COLORS.text.primary
            : (config.axisLabelColor ?? CHART_COLORS.text.primary),
        fontSize: config.axisLabelFontSize ?? 11,
        formatter: isPercentStacked
          ? (params: any) => {
              const value = typeof params.value === 'number' ? params.value : 0;
              return `${value.toFixed(2)}%`;
            }
          : undefined,
      },
      data: isPercentStacked ? convertToPercent(s.data, allSeries) : s.data,
      yAxisIndex: 0,
      emphasis: getCartesianEmphasis('line', config.lineWidth ?? 3),
      blur: getCartesianBlur(),
    }));

    const secondarySeries = (effectiveData.secondarySeries || []).map((s) => ({
      name: s.name,
      type: 'line',
      smooth: lineConfig.smooth,
      step: lineConfig.step,
      showSymbol: config.showPoints,
      symbolSize: config.symbolSize ?? 8,
      lineStyle: { width: config.lineWidth ?? 3 },
      stack: isStackedLine ? 'secondary' : undefined,
      label: {
        show: config.showDataLabel,
        position: 'top',
        color:
          config.axisLabelColor === 'default'
            ? CHART_COLORS.text.primary
            : (config.axisLabelColor ?? CHART_COLORS.text.primary),
        fontSize: config.axisLabelFontSize ?? 11,
        formatter: isPercentStacked
          ? (params: any) => {
              const value = typeof params.value === 'number' ? params.value : 0;
              return `${value.toFixed(2)}%`;
            }
          : undefined,
      },
      data: isPercentStacked ? convertToPercent(s.data, allSeries) : s.data,
      yAxisIndex: 1,
    }));

    return [...primarySeries, ...secondarySeries];
  }

  const primaryColor = colors?.[0] ?? CHART_COLORS.primary;
  return {
    name: 'Value',
    type: 'line',
    smooth: lineConfig.smooth,
    step: lineConfig.step,
    showSymbol: config.showPoints,
    symbolSize: config.symbolSize ?? 8,
    label: {
      show: config.showDataLabel,
      position: 'top',
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
      fontSize: config.axisLabelFontSize ?? 11,
      formatter: isPercentStacked
        ? (params: any) => {
            const value = typeof params.value === 'number' ? params.value : 0;
            return `${value.toFixed(2)}%`;
          }
        : undefined,
    },
    data: data?.y || [],
    lineStyle: { width: config.lineWidth ?? 3, color: primaryColor },
    itemStyle: { color: primaryColor },
    emphasis: getCartesianEmphasis('line', config.lineWidth ?? 3),
    blur: getCartesianBlur(),
  };
};

export const buildAreaSeries = (data: ChartData, config: ChartConfig, colors?: string[]) => {
  // If primary series is empty but secondary has data, treat secondary as primary.
  // This handles stale yMetricsSecondary DB state after General-tab Apply Changes.
  const effectiveData: ChartData = (!data.series?.length && data.secondarySeries?.length)
    ? { ...data, series: data.secondarySeries, secondarySeries: [] }
    : data;

  // Use shared line config
  const lineConfig = getLineStyleConfig(config);
  const isStackedArea = config.lineStackMode === 'stacked' || config.lineStackMode === 'stacked-100';
  const isPercentStacked = config.lineStackMode === 'stacked-100';

  // Helper function to convert data to percentages for 100% stacked charts
  const convertToPercent = (seriesData: any[], allSeries: any[]) => {
    if (!isPercentStacked || !Array.isArray(seriesData) || allSeries.length <= 1) return seriesData;

    return seriesData.map((value, index) => {
      const total = allSeries.reduce((sum, series) => {
        const seriesValue = Array.isArray(series.data) ? series.data[index] : 0;
        return sum + (typeof seriesValue === 'number' ? seriesValue : 0);
      }, 0);

      return total > 0 ? (value / total) * 100 : 0;
    });
  };

  if ((effectiveData.series && effectiveData.series.length > 0) || (effectiveData.secondarySeries && effectiveData.secondarySeries.length > 0)) {
    const allSeries = [...(effectiveData.series || []), ...(effectiveData.secondarySeries || [])];

    // Get colors from palette, fallback to default if not provided
    const seriesColors = colors || CHART_COLORS.secondary;

    const primarySeries = (effectiveData.series || []).map((s, index) => {
      const seriesColor = seriesColors[index % seriesColors.length];
      return {
        name: s.name,
        type: 'line',
        smooth: lineConfig.smooth,
        step: lineConfig.step,
        showSymbol: config.showPoints,
        symbolSize: config.symbolSize ?? 8,
        lineStyle: { width: config.lineWidth ?? 3 },
        stack: isStackedArea ? 'total' : undefined,
        label: {
          show: config.showDataLabel,
          position: 'top',
          color:
            config.axisLabelColor === 'default'
              ? CHART_COLORS.text.primary
              : (config.axisLabelColor ?? CHART_COLORS.text.primary),
          fontSize: config.axisLabelFontSize ?? 11,
          formatter: isPercentStacked
            ? (params: any) => {
                const value = typeof params.value === 'number' ? params.value : 0;
                return `${value.toFixed(2)}%`;
              }
            : undefined,
        },
        data: isPercentStacked ? convertToPercent(s.data, allSeries) : s.data,
        areaStyle: {
          opacity: 0.4,
          // Use palette color for gradient
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(seriesColor, 0.6) },
              { offset: 1, color: hexToRgba(seriesColor, 0.1) },
            ],
          },
        },
        yAxisIndex: 0,
      };
    });

    // Secondary series should also have area fills for area charts
    const secondarySeries = (effectiveData.secondarySeries || []).map((s, index) => {
      const seriesColor = seriesColors[(effectiveData.series?.length || 0) + index] || seriesColors[index % seriesColors.length];
      return {
        name: s.name,
        type: 'line',
        smooth: lineConfig.smooth,
        step: lineConfig.step,
        showSymbol: config.showPoints,
        symbolSize: config.symbolSize ?? 8,
        lineStyle: { width: config.lineWidth ?? 3 },
        stack: isStackedArea ? 'secondary' : undefined,
        label: {
          show: config.showDataLabel,
          position: 'top',
          color:
            config.axisLabelColor === 'default'
              ? CHART_COLORS.text.primary
              : (config.axisLabelColor ?? CHART_COLORS.text.primary),
          fontSize: config.axisLabelFontSize ?? 11,
          formatter: isPercentStacked
            ? (params: any) => {
                const value = typeof params.value === 'number' ? params.value : 0;
                return `${value.toFixed(2)}%`;
              }
            : undefined,
        },
        data: isPercentStacked ? convertToPercent(s.data, allSeries) : s.data,
        areaStyle: {
          opacity: 0.3,
          // Use palette color for secondary series
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(seriesColor, 0.5) },
              { offset: 1, color: hexToRgba(seriesColor, 0.05) },
            ],
          },
        },
        yAxisIndex: 1,
      };
    });

    return [...primarySeries, ...secondarySeries];
  }

  const primaryColor = colors?.[0] ?? CHART_COLORS.primary;
  return {
    name: 'Value',
    type: 'line',
    smooth: lineConfig.smooth,
    step: lineConfig.step,
    showSymbol: config.showPoints,
    symbolSize: config.symbolSize ?? 8,
    label: {
      show: config.showDataLabel,
      position: 'top',
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
      fontSize: config.axisLabelFontSize ?? 11,
      formatter: isPercentStacked
        ? (params: any) => {
            const value = typeof params.value === 'number' ? params.value : 0;
            return `${value.toFixed(2)}%`;
          }
        : undefined,
    },
    data: data?.y || [],
    lineStyle: { width: config.lineWidth ?? 3, color: primaryColor },
    itemStyle: { color: primaryColor },
    emphasis: getCartesianEmphasis('area', config.lineWidth ?? 3),
    blur: getCartesianBlur(),
    areaStyle: {
      opacity: 0.4,
      color:
        colors && colors.length > 0
          ? {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexToRgba(primaryColor, 0.6) },
                { offset: 1, color: hexToRgba(primaryColor, 0.1) },
              ],
            }
          : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(0, 194, 203, 0.6)' },
              { offset: 1, color: 'rgba(0, 194, 203, 0.1)' },
            ]),
    },
  };
};

export const buildPieSeries = (data: ChartData, config: ChartConfig, colors?: string[]) => {
  const compact = (config as ChartConfig & { isDashboardWidget?: boolean }).isDashboardWidget ?? true;
  const sliceBorder = getChartSliceBorderColor();

  // If we have multiple series (from multiple yMetrics), create multiple pie series (rings)
  if (data.series && data.series.length > 1) {
    const seriesCount = data.series.length;
    const innerBase = config.innerRadius || 0;
    const outerBase = compact ? 58 : 70;
    const gap = 5;
    const ringWidth = (outerBase - innerBase - (seriesCount - 1) * gap) / seriesCount;

    return data.series.map((s, i) => {
      const inner = innerBase + i * (ringWidth + gap);
      const outer = inner + ringWidth;

      const pieData = (data.x || []).map((label: string, idx: number) => ({
        value: s.data?.[idx] || 0,
        name: String(label),
      }));

      const total = pieData.reduce((sum, item) => sum + (item.value || 0), 0);
      const isZeroSum = total === 0;

      const legendPos = config.legendPosition || (config.showLegend ? 'top' : 'hide');
      const { center } = getPieLayout(legendPos, compact);

      return {
        name: s.name,
        type: 'pie',
        radius: isZeroSum ? [0, 0] : [inner + '%', outer + '%'],
        center,
        itemStyle: { borderRadius: 4, borderColor: sliceBorder, borderWidth: 2 },
        label: {
          show: config.showDataLabel && i === seriesCount - 1 && !isZeroSum,
          formatter: (params: any) => {
            if (params.name && params.value !== undefined) {
              const percentage = total > 0 ? ((params.value / total) * 100).toFixed(2) : '0.00';
              const formattedValue = formatNumber(params.value, { decimals: 1, compact: true });
              return `${params.name}: ${formattedValue} (${percentage}%)`;
            }
            return params.name || '';
          },
          fontSize: config.axisLabelFontSize ?? 10,
          color:
            config.axisLabelColor === 'default'
              ? CHART_COLORS.text.primary
              : (config.axisLabelColor ?? CHART_COLORS.text.primary),
        },
        tooltip: {
          show: !isZeroSum,
          formatter: (params: any) => {
            const percentage = total > 0 ? ((params.value / total) * 100).toFixed(1) : '0.0';
            // Show raw value in tooltip for precision
            const rawValue = typeof params.value === 'number' ? params.value.toLocaleString() : params.value;
            return `<strong>${s.name}</strong><br/>${params.name}: ${rawValue} (${percentage}%)`;
          },
        },
        stillShowZeroSum: false,
        silent: isZeroSum,
        emphasis: {
          disabled: isZeroSum,
          scale: true,
          scaleSize: 6,
          label: { show: config.showDataLabel && i === seriesCount - 1 && !isZeroSum },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.35)',
          },
        },
        data: pieData,
      };
    });
  }

  // Single series default
  const pieData = (data?.x || []).map((label: string, idx: number) => ({
    value: (data.y ?? [])[idx] ?? 0,
    name: String(label),
  }));

  // Calculate total for percentage calculation
  const total = pieData.reduce((sum, item) => sum + (item.value || 0), 0);
  const isZeroSum = total === 0;

  const legendPos = config.legendPosition || (config.showLegend ? 'top' : 'hide');
  const { center, outerRadius } = getPieLayout(legendPos, compact);

  return {
    name: 'Distribution',
    type: 'pie',
    radius: isZeroSum ? [0, 0] : [config.innerRadius + '%', outerRadius],
    center,
    itemStyle: { borderRadius: 4, borderColor: sliceBorder, borderWidth: 2 },
    label: {
      show: config.showDataLabel && !isZeroSum,
      formatter: (params: any) => {
        if (params.name && params.value !== undefined) {
          // Calculate percentage
          const percentage = total > 0 ? ((params.value / total) * 100).toFixed(1) : '0.0';
          // Format with compact notation: "Central: 847.2k (19.3%)"
          const formattedValue = formatNumber(params.value, { decimals: 1, compact: true });
          return `${params.name}: ${formattedValue} (${percentage}%)`;
        }
        return params.name || '';
      },
      fontSize: config.axisLabelFontSize ?? 12,
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
    },
    labelLine: {
      show: config.showDataLabel && !isZeroSum,
      lineStyle: { color: CHART_COLORS.text.secondary },
    },
    emphasis: {
      disabled: isZeroSum,
      focus: 'self',
      scale: true,
      scaleSize: 8,
      label: {
        show: config.showDataLabel && !isZeroSum,
        fontSize: 14,
        fontWeight: 'bold',
      },
      itemStyle: {
        shadowBlur: 12,
        shadowOffsetX: 0,
        shadowColor: 'rgba(0, 0, 0, 0.45)',
      },
    },
    stillShowZeroSum: false,
    silent: isZeroSum,
    data: pieData,
  };
};

/**
 * Factory function to build series based on chart type
 */
export const buildSeriesForType = (
  type: string,
  data: ChartData,
  config: ChartConfig,
  colors?: string[]
): any | any[] => {
  let series;
  switch (type) {
    case 'bar':
      series = buildBarSeries(data, config, colors);
      break;
    case 'line':
      series = buildLineSeries(data, config, colors);
      break;
    case 'area':
      series = buildAreaSeries(data, config, colors);
      break;
    case 'pie':
      series = buildPieSeries(data, config, colors);
      break;
    case 'donut':
      // Reuse pie series builder but default to a donut-like inner radius if not explicitly set
      series = buildPieSeries(data, { ...config, innerRadius: config.innerRadius || 40 }, colors);
      break;
    case 'scatter':
      series = buildScatterSeries(data, config);
      break;
    case 'funnel':
      series = buildFunnelSeries(data, config);
      break;
    case 'heatmap':
      series = buildHeatmapSeries(data, config);
      break;
    default:
      series = buildBarSeries(data, config);
  }
  return series;
};

export const buildHeatmapSeries = (data: ChartData, config: ChartConfig) => {
  const labelStyle = {
    show: config.showDataLabel,
    fontSize: config.axisLabelFontSize ?? 11,
    color:
      config.axisLabelColor === 'default'
        ? CHART_COLORS.text.primary
        : (config.axisLabelColor ?? CHART_COLORS.text.primary),
  };

  const heatmapCells = (data as ChartData & { heatmap?: Array<[string, string, number]> }).heatmap;
  if (Array.isArray(heatmapCells) && heatmapCells.length > 0) {
    const xLabels =
      data.x?.length && typeof data.x[0] === 'string'
        ? data.x.map(String)
        : Array.from(new Set(heatmapCells.map((cell) => String(cell[0]))));
    const yLabels =
      data.y?.length && typeof data.y[0] === 'string'
        ? data.y.map(String)
        : Array.from(new Set(heatmapCells.map((cell) => String(cell[1]))));

    const heatmapData = heatmapCells.map(([x, y, val]) => [
      xLabels.indexOf(String(x)),
      yLabels.indexOf(String(y)),
      val,
    ]);

    return {
      name: 'Heatmap',
      type: 'heatmap',
      data: heatmapData,
      label: labelStyle,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)',
        },
      },
    };
  }

  if (!data.group_field || data.group_field.length === 0) {
    // If no group_field, heatmap doesn't make much sense, fallback to bar-like heatmap
    return {
      type: 'heatmap',
      data: (data.x || []).map((x, i) => [i, 0, data.y?.[i] || 0]),
      label: {
        show: config.showDataLabel,
        fontSize: config.axisLabelFontSize ?? 11,
        color:
          config.axisLabelColor === 'default'
            ? CHART_COLORS.text.primary
            : (config.axisLabelColor ?? CHART_COLORS.text.primary),
      },
    };
  }

  // Get unique labels for axes
  const xLabels = Array.from(new Set((data.x || []).map(String)));
  const yLabels = Array.from(new Set((data.group_field || []).map(String)));

  // Map data to [xIndex, yIndex, value]
  const heatmapData = (data.x || []).map((x, i) => {
    const xIdx = xLabels.indexOf(String(x));
    const yIdx = yLabels.indexOf(String(data.group_field?.[i]));
    return [xIdx, yIdx, data.y?.[i] || 0];
  });

  return {
    name: 'Heatmap',
    type: 'heatmap',
    data: heatmapData,
    label: {
      show: config.showDataLabel,
      fontSize: config.axisLabelFontSize ?? 11,
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
    },
    emphasis: {
      itemStyle: {
        shadowBlur: 10,
        shadowColor: 'rgba(0, 0, 0, 0.5)',
      },
    },
  };
};

export const buildScatterSeries = (data: ChartData, config: ChartConfig) => {
  const scatterSymbolSize = config.symbolSize ?? 6;

  // If the backend returned raw points in a single series [x, y, legend],
  // partition them locally for coloring and legend support.
  if (data.series && data.series.length === 1) {
    const rawData = data.series[0]?.data || [];
    if (rawData.length > 0 && Array.isArray(rawData[0]) && rawData[0].length === 3) {
      const seriesMap: Record<string, any[]> = {};
      rawData.forEach((point: any[]) => {
        const legendVal = point[2];
        const gName = legendVal === null || legendVal === undefined ? 'Unknown' : String(legendVal);
        if (!seriesMap[gName]) seriesMap[gName] = [];

        // Ensure numbers for ECharts value axis
        const x = typeof point[0] === 'number' ? point[0] : parseFloat(String(point[0]));
        const y = typeof point[1] === 'number' ? point[1] : parseFloat(String(point[1]));

        seriesMap[gName].push([isNaN(x) ? 0 : x, isNaN(y) ? 0 : y, gName]);
      });

      return Object.entries(seriesMap).map(([name, points]) => ({
        name,
        type: 'scatter',
        symbolSize: scatterSymbolSize,
        itemStyle: { opacity: 0.6 },
        label: {
          show: config.showDataLabel,
          position: 'top',
          fontSize: config.axisLabelFontSize ?? 11,
          color:
            config.axisLabelColor === 'default'
              ? CHART_COLORS.text.primary
              : (config.axisLabelColor ?? CHART_COLORS.text.primary),
          formatter: (params: any) => params.data[1]?.toLocaleString() ?? '',
        },
        data: points,
      }));
    }
  }

  // If we have group_field (Legacy/Parallel arrays), partition it
  if (data.group_field && data.group_field.length > 0) {
    const seriesMap: Record<string, any[]> = {};
    (data.y || []).forEach((val, idx) => {
      const gValue = data.group_field![idx];
      const gName = gValue === null || gValue === undefined ? 'Unknown' : String(gValue);

      if (!seriesMap[gName]) {
        seriesMap[gName] = [];
      }

      const xVal = data.x?.[idx];
      const x = typeof xVal === 'number' ? xVal : parseFloat(String(xVal));
      const y = typeof val === 'number' ? val : parseFloat(String(val));
      seriesMap[gName].push([isNaN(x) ? 0 : x, isNaN(y) ? 0 : y, gName]);
    });

    return Object.entries(seriesMap).map(([name, points]) => ({
      name,
      type: 'scatter',
      symbolSize: scatterSymbolSize,
      itemStyle: { opacity: 0.6 },
      data: points,
    }));
  }

  // Standard series / Single series fallback
  if (data.series && data.series.length > 0) {
    return data.series.map((s) => ({
      name: s.name,
      type: 'scatter',
      symbolSize: scatterSymbolSize,
      itemStyle: { opacity: 0.6 },
      label: {
        show: config.showDataLabel,
        position: 'top',
        fontSize: config.axisLabelFontSize ?? 11,
        color:
          config.axisLabelColor === 'default'
            ? CHART_COLORS.text.primary
            : (config.axisLabelColor ?? CHART_COLORS.text.primary),
        formatter: (params: any) => {
          const val = Array.isArray(params.data) ? params.data[1] : params.data;
          return val?.toLocaleString() ?? '';
        },
      },
      data: s.data.map((item, idx) => {
        if (Array.isArray(item)) return item;
        const xVal = data.x?.[idx];
        const x = typeof xVal === 'number' ? xVal : parseFloat(String(xVal));
        const y = typeof item === 'number' ? item : parseFloat(String(item));
        return [isNaN(x) ? 0 : x, isNaN(y) ? 0 : y];
      }),
    }));
  }

  return {
    name: config.yAxisLabel || 'Value',
    type: 'scatter',
    symbolSize: scatterSymbolSize,
    itemStyle: { opacity: 0.6, color: CHART_COLORS.primary },
    label: {
      show: config.showDataLabel,
      position: 'top',
      fontSize: config.axisLabelFontSize ?? 11,
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.primary
          : (config.axisLabelColor ?? CHART_COLORS.text.primary),
      formatter: (params: any) => params.data[1]?.toLocaleString() ?? '',
    },
    data: (data?.y || []).map((val, idx) => {
      const xVal = data.x?.[idx];
      const x = typeof xVal === 'number' ? xVal : parseFloat(String(xVal));
      const y = typeof val === 'number' ? val : parseFloat(String(val));
      return [isNaN(x) ? 0 : x, isNaN(y) ? 0 : y];
    }),
  };
};

export const buildFunnelSeries = (data: ChartData, config: ChartConfig) => {
  const funnelData = (data.x || []).map((label: string, idx: number) => ({
    value: (data.y ?? [])[idx] ?? 0,
    name: String(label),
  }));

  // Sort data descending for a traditional funnel appearance if requested
  // funnelData.sort((a,b) => b.value - a.value);

  return {
    name: 'Funnel',
    type: 'funnel',
    left: '10%',
    top: 60,
    bottom: 60,
    width: '80%',
    minSize: '0%',
    maxSize: '100%',
    sort: 'descending',
    gap: 2,
    label: {
      show: true,
      position: 'inside',
      color: config.axisLabelColor === 'default' ? '#fff' : (config.axisLabelColor ?? '#fff'),
      fontSize: config.axisLabelFontSize ?? 12,
    },
    labelLine: { show: false },
    itemStyle: { borderColor: CHART_COLORS.background, borderWidth: 1 },
    emphasis: { label: { fontSize: 14 } },
    data: funnelData,
  };
};
