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
import { getPieLayout } from './chartLayoutUtils';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';

/** Format a numeric value according to the widget's configured valueFormat. */
function fmtVal(v: unknown, valueFormat?: string): string {
  const num = Number(v);
  if (isNaN(num)) return String(v ?? '');
  switch (valueFormat) {
    case 'compact': {
      const abs = Math.abs(num);
      if (abs >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
      if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
      if (abs >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
      return num.toLocaleString();
    }
    case 'currency':
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
    case 'percent':
      return `${num.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'full':
      return num.toLocaleString();
    default:
      return num.toLocaleString();
  }
}

export const buildChartOptions = (type: string, data: ChartData, config: Partial<ChartConfig> = {}): any => {
  const isDesigner = (config as any).isDesigner;
  const isDashboardWidget = (config as any).isDashboardWidget ?? !isDesigner;
  // Merge with defaults
  const finalConfig: ChartConfig = { 
    ...DEFAULT_CHART_CONFIG, 
    ...config,
    // Automatically boost font sizes in designer mode if not explicitly set
    axisLabelFontSize: config.axisLabelFontSize ?? (isDesigner ? 12.5 : 11),
    legendFontSize: config.legendFontSize ?? (isDesigner ? 13.5 : 12),
    vAxisFontSize: config.vAxisFontSize ?? (isDesigner ? 12.5 : 11),
    hAxisFontSize: config.hAxisFontSize ?? (isDesigner ? 12.5 : 11),
    ...( { isDashboardWidget } as Partial<ChartConfig> ),
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

  // Resolve palette: widget override → dashboard default → brand palette
  const paletteName = resolveChartPaletteId(
    (config as any).colorPalette,
    (config as any).dashboardDefaultPalette,
  );
  const effectivePalette = paletteName === 'custom' ? 'default' : paletteName;
  let chartColors = getColorsFromPalette(effectivePalette, colorCount);

  if (colorCount > 8 && effectivePalette === 'default') {
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
  let tooltipConfig: any = getBaseTooltipConfig(type, { appendToBody: isDashboardWidget });
  const isPercentStacked =
    (type === 'bar' && finalConfig.barStackMode === 'stacked-100') ||
    ((type === 'line' || type === 'area') && finalConfig.lineStackMode === 'stacked-100');

  if (type === 'pie' || type === 'donut') {
    // Calculate total for percentage
    const total = (data?.y || []).reduce((sum: number, val: number) => sum + (val || 0), 0);
    const vf = (config as any).valueFormat as string | undefined;
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        const percentage = total > 0 ? ((params.value / total) * 100).toFixed(2) : '0.00';
        const rawValue = typeof params.value === 'number' ? fmtVal(params.value, vf) : params.value;
        const marker = params.marker || '';
        return `${marker} <strong>${params.name}</strong><br/>Value: ${rawValue}<br/>Share: ${percentage}%`;
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
    // Enhanced tooltip for other chart types — respect valueFormat if set
    const vf = (config as any).valueFormat as string | undefined;
    tooltipConfig = {
      ...tooltipConfig,
      formatter: (params: any) => {
        if (Array.isArray(params) && params.length > 0) {
          let tooltip = `<strong>${params[0].name || ''}</strong><br/>`;
          params.forEach((param: any) => {
            const rawValue = typeof param.value === 'number' ? fmtVal(param.value, vf) : (param.value ?? '');
            tooltip += `${param.marker || ''} ${param.seriesName || ''}: ${rawValue}<br/>`;
          });
          return tooltip;
        } else if (params && !Array.isArray(params)) {
          const rawValue = typeof params.value === 'number' ? fmtVal(params.value, vf) : (params.value ?? '');
          return `<strong>${params.name || ''}</strong><br/>${params.marker || ''} ${params.seriesName || ''}: ${rawValue}`;
        }
        return '';
      },
    };
  }

  const series = buildSeriesForType(type, data, finalConfig, chartColors);
  let seriesArray = Array.isArray(series) ? series : [series];

  // ─── Legend series sort & limit ───────────────────────────────────────────
  const legendSort: string | undefined = (config as any).legendSort;   // 'asc' | 'desc' | undefined
  const legendLimit: number | undefined = (config as any).legendLimit; // positive int | undefined

  if ((legendSort || legendLimit) && seriesArray.length > 1) {
    // Multi-series (grouped): sort/limit by sum of each series' data values
    let sorted = [...seriesArray].map((s) => ({
      s,
      total: Array.isArray(s.data) ? s.data.reduce((acc: number, v: unknown) => acc + (Number(v) || 0), 0) : 0,
    }));
    if (legendSort === 'asc') sorted.sort((a, b) => a.total - b.total);
    else if (legendSort === 'desc') sorted.sort((a, b) => b.total - a.total);
    if (legendLimit && legendLimit > 0) sorted = sorted.slice(0, legendLimit);
    seriesArray = sorted.map((x) => x.s);
  }

  // ─── Reference lines & trend lines ────────────────────────────────────────
  const supportsMarkLines = ['bar', 'line', 'area', 'scatter', 'waterfall'].includes(type);
  if (supportsMarkLines && seriesArray.length > 0) {
    const markLineData: any[] = [];

    // Configurable reference lines (array of { value, label, color, type })
    const refLines: any[] = (config as any).referenceLines || [];
    refLines.forEach((ref: any) => {
      if (ref.value != null) {
        markLineData.push({
          yAxis: ref.value,
          name: ref.label || '',
          lineStyle: { color: ref.color || '#faad14', type: ref.style || 'dashed', width: 1.5 },
          label: { formatter: ref.label ? `${ref.label}: ${ref.value}` : String(ref.value), position: 'end', fontSize: 11 },
        });
      }
    });

    // Auto average line
    if ((config as any).showAverageLine) {
      const allY = (data.y || []).map(Number).filter((v: number) => !isNaN(v));
      if (allY.length > 0) {
        const avg = allY.reduce((a: number, b: number) => a + b, 0) / allY.length;
        markLineData.push({
          yAxis: avg,
          name: 'Avg',
          lineStyle: { color: '#52c41a', type: 'dashed', width: 1.5 },
          label: { formatter: `Avg: ${avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}`, position: 'end', fontSize: 11 },
        });
      }
    }

    // Trend line (linear regression) for line/area/scatter
    if ((config as any).showTrendLine && ['line', 'area', 'scatter'].includes(type)) {
      const allY = (data.y || []).map(Number).filter((v: number) => !isNaN(v));
      if (allY.length >= 2) {
        // Simple linear regression: y = mx + b
        const n = allY.length;
        const xArr = allY.map((_: number, i: number) => i);
        const sumX = xArr.reduce((a: number, b: number) => a + b, 0);
        const sumY = allY.reduce((a: number, b: number) => a + b, 0);
        const sumXY = xArr.reduce((s: number, x: number, i: number) => s + x * allY[i], 0);
        const sumX2 = xArr.reduce((s: number, x: number) => s + x * x, 0);
        const denom = n * sumX2 - sumX * sumX || 1;
        const m = (n * sumXY - sumX * sumY) / denom;
        const b = (sumY - m * sumX) / n;
        const trendData = xArr.map((x: number) => m * x + b);

        seriesArray.push({
          type: 'line',
          name: 'Trend',
          data: trendData,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#722ed1', type: 'dashed', width: 2 },
          z: 5,
          silent: true,
          tooltip: { show: false },
        });
      }
    }

    if (markLineData.length > 0 && seriesArray[0]) {
      seriesArray[0] = {
        ...seriesArray[0],
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          data: markLineData,
        },
      };
    }

    // ─── Anomaly highlighting via IQR ─────────────────────────────────────
    if ((config as any).showAnomalies && ['line', 'area', 'bar', 'scatter'].includes(type)) {
      const allY = (data.y || []).map(Number).filter((v: number) => !isNaN(v));
      if (allY.length >= 4) {
        const sorted = [...allY].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;

        const markPointData = allY
          .map((v: number, i: number) => (v < lo || v > hi ? { coord: [data.x?.[i] ?? i, v] } : null))
          .filter(Boolean);

        if (markPointData.length > 0 && seriesArray[0]) {
          seriesArray[0] = {
            ...seriesArray[0],
            markPoint: {
              data: markPointData,
              symbol: 'circle',
              symbolSize: 12,
              itemStyle: { color: '#ff4d4f', opacity: 0.85 },
              label: { show: false },
              tooltip: {
                formatter: (p: any) => `<strong>Outlier</strong><br/>Value: ${fmtVal(p.value[1], (config as any).valueFormat)}`,
              },
            },
          };
        }
      }
    }
  }

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
    stateAnimation: { duration: 200, easing: 'cubicOut' },
    backgroundColor: finalConfig.backgroundColor || 'transparent',
    color: chartColors,
    tooltip: tooltipConfig,
    legend: getBaseLegendConfig(
      (finalConfig.showLegend ?? true) && (type !== 'scatter' || seriesArray.length > 1),
      type,
      {
        ...finalConfig,
        legendFontSize: finalConfig.legendFontSize ?? (isDashboardWidget ? 11 : isDesigner ? 13.5 : 12),
      }
    ),
    series: seriesArray,
  };

  const nonCartesianTypes = ['pie', 'donut', 'funnel', 'heatmap'];
  if (type === 'pie' || type === 'donut') {
    const legendPos = finalConfig.legendPosition || (finalConfig.showLegend !== false ? 'top' : 'hide');
    const { center } = getPieLayout(legendPos, isDashboardWidget);
    baseOptions.series = seriesArray.map((s: { center?: string[]; radius?: string | string[] }) => ({
      ...s,
      center: s.center ?? center,
    }));
  }

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

  // ─── Gauge chart ──────────────────────────────────────────────────────────
  if (type === 'gauge') {
    const gaugeValue = typeof data.value !== 'undefined' ? Number(data.value)
      : Array.isArray(data.y) && data.y.length > 0 ? Number(data.y[0])
      : Array.isArray(data.series) && data.series[0]?.data?.length > 0 ? Number(data.series[0].data[0])
      : 0;
    const gaugeMin = (config as any).gaugeMin ?? 0;
    const gaugeMax = (config as any).gaugeMax ?? 100;
    const gaugeName = (config as any).gaugeLabel || '';
    const gaugeUnit = (config as any).gaugeUnit || '';
    const targetValue = (config as any).gaugeTarget;

    baseOptions.series = [{
      type: 'gauge',
      min: gaugeMin,
      max: gaugeMax,
      startAngle: 200,
      endAngle: -20,
      radius: '85%',
      center: ['50%', '60%'],
      progress: { show: true, width: 18, itemStyle: { color: chartColors[0] } },
      axisLine: { lineStyle: { width: 18, color: [[1, 'rgba(0,0,0,0.06)']] } },
      pointer: { show: true, length: '60%', width: 6 },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { fontSize: 11, color: CHART_COLORS.text.secondary, distance: 25 },
      anchor: { show: true, size: 14, itemStyle: { color: chartColors[0] } },
      detail: {
        valueAnimation: true,
        fontSize: 22,
        fontWeight: 700,
        color: chartColors[0],
        formatter: (v: number) => `${v.toLocaleString()}${gaugeUnit}`,
        offsetCenter: [0, '25%'],
      },
      title: { show: !!gaugeName, offsetCenter: [0, '45%'], fontSize: 12, color: CHART_COLORS.text.secondary },
      data: [{ value: gaugeValue, name: gaugeName }],
      ...(targetValue != null ? {
        markLine: { data: [{ xAxis: targetValue }], silent: true, lineStyle: { color: '#faad14', type: 'dashed' } }
      } : {}),
    }];
    delete baseOptions.xAxis;
    delete baseOptions.yAxis;
    delete baseOptions.grid;
    return baseOptions;
  }

  // ─── Treemap ──────────────────────────────────────────────────────────────
  if (type === 'treemap') {
    const treemapData = Array.isArray(data.x)
      ? data.x.map((name: string, i: number) => ({ name: String(name), value: Number(data.y?.[i] ?? 0) }))
      : Array.isArray(data.series) && data.series[0]
        ? data.series[0].data.map((v: number, i: number) => ({ name: String(data.categories?.[i] ?? i), value: v }))
        : [];
    baseOptions.series = [{
      type: 'treemap',
      roam: false,
      leafDepth: 2,
      label: { show: true, formatter: '{b}: {c}' },
      upperLabel: { show: true, height: 30 },
      itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', gapWidth: 2 },
      data: treemapData,
      breadcrumb: { show: false },
    }];
    delete baseOptions.xAxis;
    delete baseOptions.yAxis;
    delete baseOptions.grid;
    return baseOptions;
  }

  // ─── Waterfall chart ──────────────────────────────────────────────────────
  if (type === 'waterfall') {
    const cats = data.x || [];
    const vals = Array.isArray(data.y) ? data.y.map(Number) : [];
    // Build invisible + positive + negative series for waterfall
    let running = 0;
    const base: number[] = [];
    const pos: number[] = [];
    const neg: number[] = [];
    vals.forEach((v) => {
      if (v >= 0) { base.push(running); pos.push(v); neg.push(0); }
      else { base.push(running + v); pos.push(0); neg.push(-v); }
      running += v;
    });
    baseOptions.xAxis = [{ type: 'category', data: cats, axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 11 } }];
    baseOptions.yAxis = [{ type: 'value', axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 11 } }];
    baseOptions.series = [
      { type: 'bar', stack: 'wf', itemStyle: { color: 'transparent', borderColor: 'transparent' }, data: base, silent: true },
      { name: 'Increase', type: 'bar', stack: 'wf', itemStyle: { color: chartColors[0] }, data: pos },
      { name: 'Decrease', type: 'bar', stack: 'wf', itemStyle: { color: chartColors[1] || '#ff4d4f' }, data: neg },
    ];
    baseOptions.legend = { show: finalConfig.showLegend ?? true, data: ['Increase', 'Decrease'] };
    return baseOptions;
  }

  // ─── Bullet chart ─────────────────────────────────────────────────────────
  // Shows actual vs target in a compact horizontal bar with threshold bands.
  if (type === 'bullet') {
    const categories = Array.isArray(data.x) ? data.x : [];
    const actuals: number[] = Array.isArray(data.y) ? data.y.map(Number) : [];
    // Target values come from series[0] if available, else config
    const targets: number[] = Array.isArray(data.series?.[0]?.data)
      ? data.series[0].data.map(Number)
      : actuals.map(() => (config as any).bulletTarget ?? 0);

    const bulletThresholdWarn: number = (config as any).bulletThresholdWarn ?? 60;
    const bulletThresholdOk: number = (config as any).bulletThresholdOk ?? 80;
    const bulletMax: number = (config as any).bulletMax
      ?? Math.max(...actuals, ...targets, 100) * 1.1;

    const bandColors = ['rgba(255,77,79,0.12)', 'rgba(250,173,20,0.14)', 'rgba(82,196,26,0.14)'];

    baseOptions.xAxis = [{
      type: 'value',
      min: 0,
      max: bulletMax,
      axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
    }];
    baseOptions.yAxis = [{
      type: 'category',
      data: categories.map(String),
      axisLabel: { color: CHART_COLORS.text.secondary, fontSize: 12 },
      axisTick: { show: false },
    }];
    // Band series (invisible stacked bars to show threshold regions)
    const band1Data = categories.map(() => bulletThresholdWarn);
    const band2Data = categories.map(() => bulletThresholdOk - bulletThresholdWarn);
    const band3Data = categories.map(() => bulletMax - bulletThresholdOk);
    // Actual series
    const actualSeries = {
      name: (config as any).bulletActualLabel || 'Actual',
      type: 'bar' as const,
      z: 3,
      barWidth: '35%',
      barGap: '-100%',
      data: actuals,
      itemStyle: { color: chartColors[0] },
      label: {
        show: true,
        position: 'right' as const,
        formatter: (p: { value: number }) => p.value.toLocaleString(),
        fontSize: 11,
        color: CHART_COLORS.text.secondary,
      },
    };
    // Target markLine per series
    const markLines = {
      silent: true,
      symbol: ['none', 'none'],
      data: targets.map((t, i) => ([
        { coord: [t, i - 0.4], lineStyle: { color: '#faad14', width: 3, type: 'solid' as const } },
        { coord: [t, i + 0.4] },
      ])),
    };

    baseOptions.series = [
      // Background bands
      { type: 'bar', stack: 'bullet-bg', z: 1, barWidth: '70%', barGap: '-100%', data: band1Data, itemStyle: { color: bandColors[0], borderRadius: 0 }, silent: true, legendHoverLink: false, label: { show: false } },
      { type: 'bar', stack: 'bullet-bg', z: 1, barWidth: '70%', barGap: '-100%', data: band2Data, itemStyle: { color: bandColors[1], borderRadius: 0 }, silent: true, legendHoverLink: false, label: { show: false } },
      { type: 'bar', stack: 'bullet-bg', z: 1, barWidth: '70%', barGap: '-100%', data: band3Data, itemStyle: { color: bandColors[2], borderRadius: 0 }, silent: true, legendHoverLink: false, label: { show: false } },
      // Actual bar
      { ...actualSeries, markLine: markLines },
    ];

    baseOptions.legend = { show: false };
    baseOptions.grid = {
      ...(baseOptions.grid as object || {}),
      left: 90,
      right: 60,
      top: 12,
      bottom: 24,
      containLabel: false,
    };
    return baseOptions;
  }

  return baseOptions;
};
