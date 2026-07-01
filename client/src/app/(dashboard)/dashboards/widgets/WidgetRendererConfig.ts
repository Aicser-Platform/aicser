/**
 * Configuration for chart rendering
 * Centralized colors, defaults, and chart settings
 */

import { formatAxisLabel, formatNumber } from '../utils/numberFormatter';

/** Format a value for axis labels/tooltips based on the widget's valueFormat setting. */
export function formatByValueFormat(value: unknown, valueFormat?: string): string {
  const num = Number(value);
  if (isNaN(num)) return String(value ?? '');
  switch (valueFormat) {
    case 'compact': return formatNumber(num, { compact: true, decimals: 1 });
    case 'currency': return formatNumber(num, { currency: true, compact: true, decimals: 0 });
    case 'percent': return `${num.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'full': return num.toLocaleString();
    default: return formatAxisLabel(num); // auto-compact
  }
}

// Helper to check if dark mode is active
export const isDark = () => {
  if (typeof window === 'undefined') return false;
  const html = document.documentElement;
  const body = document.body;
  const dataTheme = html.getAttribute('data-theme') || body.getAttribute('data-theme');
  if (dataTheme === 'dark') return true;
  return html.classList.contains('dark') || body.classList.contains('dark');
};

// Color palettes for charts
export const COLOR_PALETTES = {
  default: [
    '#00c2cb', // Teal (Primary)
    '#2c3e50', // Dark Blue
    '#e74c3c', // Red
    '#3498db', // Blue
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Mint
    '#d35400', // Dark Orange
    '#8e44ad', // Dark Purple
    '#c0392b', // Dark Red
    '#16a085', // Sea Green
  ],
  vibrant: [
    '#ff5e5e', // Coral
    '#ffbd39', // Gold
    '#1ac0c6', // Turquoise
    '#454ade', // Royal Blue
    '#805ad5', // Purple
    '#f56565', // Red-Pink
    '#48bb78', // Leaf Green
    '#ed8936', // Pumpkin
    '#4299e1', // Sky Blue
    '#0bc5ea', // Cyan
    '#667eea', // Indigo
    '#f6ad55', // Peach
  ],
  cool: [
    '#3498db', '#5dade2', '#85c1e9', '#aed6f1', '#d6eaf8',
    '#5499c7', '#2980b9', '#2471a3', '#1f618d', '#1a5276',
    '#154360', '#54a0ff'
  ],
  warm: [
    '#e67e22', '#f39c12', '#d35400', '#e74c3c', '#c0392b',
    '#f1948a', '#ec7063', '#eb984e', '#f5b041', '#f8c471',
    '#dc7633', '#ba4a00'
  ],
  nature: [
    '#27ae60', '#2ecc71', '#1abc9c', '#16a085', '#27ae60',
    '#76d7c4', '#52be80', '#229954', '#1d8348', '#196f3d',
    '#145a32', '#a9dfbf'
  ],
  corporate: [
    '#2c3e50', '#34495e', '#5d6d7e', '#85929e', '#aeb6bf',
    '#d6dbdf', '#212f3d', '#283747', '#2e4053', '#34495e',
    '#566573', '#1c2833'
  ],
  pastel: [
    '#ff9ff3', '#feca57', '#ff6b6b', '#48dbfb', '#1dd1a1',
    '#00d2d3', '#54a0ff', '#5f27cd', '#c8d6e5', '#222f3e',
    '#ff9f43', '#ee5253'
  ],
  infographic: [
    '#00c2cb', '#ffcc00', '#ff6666', '#66cc99', '#9966ff',
    '#ff9933', '#3399ff', '#cc33ff', '#33cc33', '#ff3366',
    '#006699', '#666666'
  ],
  spectrum: [
    '#4dc3ff', '#44d7b6', '#6dd400', '#ffcf00', '#ff9f00',
    '#ff5b5b', '#e02020', '#fa6400', '#f7b500', '#6dd400',
    '#0091ff', '#6236ff'
  ]
};

// Function to get colors from palette name with optional count for dynamic generation
export const getColorsFromPalette = (paletteName: string, count?: number): string[] => {
  const palette = COLOR_PALETTES[paletteName as keyof typeof COLOR_PALETTES];
  
  if (paletteName === 'diverse' && count) {
    return generateDiversePalette(count);
  }

  if (palette && count && count > palette.length) {
    // If we need more colors than the palette provides, use the golden angle to extend it
    const extended = [...palette];
    for (let i = palette.length; i < count; i++) {
        const hue = (200 + (i * 137.5)) % 360; // Distribute hues
        extended.push(`hsl(${hue}, 65%, 50%)`);
    }
    return extended;
  }
  
  return palette || COLOR_PALETTES.default;
};

// Generates a set of distinct colors using golden angle distribution for maximum hue diversity
export const generateDiversePalette = (count: number): string[] => {
  const colors: string[] = [];
  // Use golden angle approximation (137.5 degrees) for optimal distribution of hues
  for (let i = 0; i < count; i++) {
    const hue = (200 + (i * 137.508)) % 360; 
    const saturation = 60 + (i % 2) * 10; // Slight variation in saturation
    const lightness = 50 + (i % 3) * 5;    // Slight variation in lightness
    colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
  }
  return colors;
};

export const CHART_COLORS = {
  primary: '#00c2cb',
  secondary: [
    '#00c2cb', '#2c3e50', '#e74c3c', '#3498db', '#2ecc71', 
    '#f39c12', '#9b59b6', '#1abc9c', '#d35400', '#8e44ad', 
    '#c0392b', '#16a085'
  ],
  get text() {
    const dark = isDark();
    return {
      primary: dark ? '#e6edf3' : '#24292f',
      secondary: dark ? '#8b949e' : '#57606a',
      muted: dark ? '#484f58' : '#8b949e',
    };
  },
  get border() {
    const dark = isDark();
    return {
      light: dark ? '#30363d' : '#e1e4e8',
      lighter: dark ? '#21262d' : '#f1f3f5',
    };
  },
  get background() {
    return isDark() ? '#0d1117' : '#fff';
  },
  gradient: {
    start: '#00c2cb',
    end: '#2ed3db',
  },
};

export const DEFAULT_CHART_CONFIG = {
  showLegend: true,
  showDataLabel: false,
  showGridline: true,
  showAxis: true,
  showYAxisLegend: true,
  smooth: true,
  stacked: false,
  innerRadius: 0,
  showPoints: true,
  barChartType: 'vertical' as const, // Use const assertion for proper typing
  barStackMode: 'none' as const, // Default stack mode
  lineChartType: 'line' as const, // Default line chart type
  lineStackMode: 'none' as const, // Default line chart stack mode
};

export type ChartValueFormat = 'auto' | 'compact' | 'currency' | 'percent' | 'full';

/** Solid grey axis grid — used by dashboard widgets (not dashed/dotted). */
export const CHART_GRID_LINE_STYLE = {
  color: CHART_COLORS.border.light,
  type: 'solid' as const,
  width: 1,
};

export interface ChartConfig {
  showLegend?: boolean;
  showDataLabel?: boolean;
  showGridline?: boolean;
  showAxis?: boolean;
  showYAxisLegend?: boolean;
  smooth?: boolean;
  stacked?: boolean;
  innerRadius?: number;
  showPoints?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'hide';
  legendFontSize?: number;
  legendFontWeight?: number | string;
  axisLabelFontSize?: number;
  axisLabelColor?: string;
  gridLineOpacity?: number;
  lineWidth?: number;
  symbolSize?: number;
  gridTop?: number;
  gridBottom?: number;
  gridLeft?: number;
  gridRight?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  yAxisSecondaryLabel?: string;
  backgroundColor?: string;
  titleColor?: string;
  titleFontWeight?: string | number;
  barChartType?: 'vertical' | 'horizontal' | 'combo-line'; // Bar chart orientation
  barStackMode?: 'none' | 'stacked' | 'stacked-100'; // Bar chart stacking mode
  lineChartType?: 'line' | 'smooth' | 'step'; // Line chart type variations
  lineStackMode?: 'none' | 'stacked' | 'stacked-100'; // Line chart stacking mode

  // New Axis Properties
  showVAxisLabels?: boolean;
  vAxisLabelSlant?: 'none' | 'right-diagonal' | 'left-diagonal' | 'up' | 'down';
  vAxisFontSize?: number;
  vAxisColor?: string;
  vAxisBold?: boolean;
  vAxisItalic?: boolean;
  vAxisStrikethrough?: boolean;
  vAxisUnderline?: boolean;
  showVAxisLine?: boolean;

  showHAxisLabels?: boolean;
  hAxisLabelSlant?: 'none' | 'right-diagonal' | 'left-diagonal' | 'up' | 'down';
  hAxisFontSize?: number;
  hAxisColor?: string;
  hAxisBold?: boolean;
  hAxisItalic?: boolean;
  hAxisStrikethrough?: boolean;
  hAxisUnderline?: boolean;
  showHAxisLine?: boolean;
  /** Dashboard grid tiles — tighter chrome so axes/labels survive small card sizes */
  isDashboardWidget?: boolean;
  /** Extra-dense rendering used by immutable dashboard snapshots in feed cards. */
  isFeedPreview?: boolean;
  /**
   * Value display format applied to tooltips and (optionally) axis labels.
   * 'compact' → 1.2K / 3.4M
   * 'currency' → $1,234
   * 'percent' → 12.3%
   * 'full' → 1,234,567  (no abbreviation)
   * undefined / 'auto' → compact (legacy default for axis), full for tooltips
   */
  valueFormat?: ChartValueFormat;
  /** Optional per-series display formats, keyed by metric field/label/series name. */
  metricFormats?: Record<string, ChartValueFormat>;
  /** Highlight statistical outliers (IQR method) with markPoints on line/bar/area/scatter charts. */
  showAnomalies?: boolean;
  /** Widget-level border width in pixels (0 = none) */
  borderWidth?: number;
  /** Widget-level border color */
  borderColor?: string;
  /** Widget-level box shadow preset */
  boxShadow?: 'sm' | 'md' | 'lg';
}

export interface ChartData {
  x: any[];
  y: any[];
  series?: { name: string; data: any[] }[];
  secondarySeries?: { name: string; data: any[] }[];
  group_field?: any[];
  /** Scalar value for gauge/single-metric charts. */
  value?: number | null;
  /** Category labels for treemap / series-based builders. */
  categories?: string[];
  /** Raw heatmap cell tuples [xLabel, yLabel, value] for heatmap charts. */
  heatmap?: Array<[string, string, number]>;
}

const applyTextDecorations = (text: string, underline?: boolean, strikethrough?: boolean) => {
  if (!underline && !strikethrough) {
    return text;
  }

  const underlineChar = '\u0332';
  const strikethroughChar = '\u0336';

  return text
    .split('')
    .map((char) => {
      if (char.trim() === '') {
        return char;
      }

      let decorated = char;
      if (underline) {
        decorated += underlineChar;
      }
      if (strikethrough) {
        decorated += strikethroughChar;
      }
      return decorated;
    })
    .join('');
};

export const getBaseTooltipConfig = (type: string, opts?: { appendToBody?: boolean }) => {
  const appendToBody = opts?.appendToBody ?? false;
  const dark = isDark();
  const isItemTrigger = ['pie', 'donut', 'funnel', 'heatmap'].includes(type);
  const isLineFamily = ['line', 'area'].includes(type);
  const borderColor = CHART_COLORS.border.light;

  return {
    trigger: isItemTrigger ? 'item' : 'axis',
    confine: !appendToBody,
    appendToBody,
    className: 'dashboard-chart-tooltip',
    renderMode: 'html' as const,
    backgroundColor: dark ? 'rgba(22, 27, 34, 0.97)' : 'rgba(255, 255, 255, 0.98)',
    borderColor,
    borderWidth: 1,
    borderRadius: 8,
    padding: [10, 14],
    textStyle: { color: CHART_COLORS.text.primary, fontSize: 13, lineHeight: 20 },
    extraCssText: `box-shadow: 0 8px 24px rgba(0,0,0,${dark ? '0.45' : '0.14'}); backdrop-filter: blur(8px); z-index: 99999 !important; pointer-events: none;`,
    transitionDuration: 0.15,
    axisPointer: isItemTrigger
      ? undefined
      : {
          type: isLineFamily ? 'cross' : 'shadow',
          snap: true,
          crossStyle: {
            color: CHART_COLORS.primary,
            width: 1,
            type: 'dashed' as const,
            opacity: 0.85,
          },
          lineStyle: {
            color: CHART_COLORS.primary,
            width: 1,
            type: 'dashed' as const,
            opacity: 0.85,
          },
          shadowStyle: {
            color: dark ? 'rgba(0, 194, 203, 0.14)' : 'rgba(0, 194, 203, 0.1)',
          },
          label: {
            backgroundColor: dark ? '#21262d' : '#f6f8fa',
            borderColor,
            borderWidth: 1,
            color: CHART_COLORS.text.primary,
            fontSize: 11,
            padding: [4, 6],
          },
        },
  };
};

/** Dim non-hovered series/points (Tableau-style focus). */
export const getCartesianBlur = (): Record<string, unknown> => ({
  itemStyle: { opacity: 0.22 },
  lineStyle: { opacity: 0.18 },
  areaStyle: { opacity: 0.08 },
});

/** Shared hover emphasis for cartesian series (bar / line / area). */
export const getCartesianEmphasis = (
  kind: 'bar' | 'line' | 'area',
  lineWidth = 3,
): Record<string, unknown> => {
  if (kind === 'bar') {
    return {
      focus: 'self',
      blurScope: 'coordinateSystem',
      itemStyle: {
        opacity: 1,
        shadowBlur: 12,
        shadowOffsetY: 2,
        shadowColor: isDark() ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)',
      },
    };
  }
  return {
    focus: 'series',
    blurScope: 'coordinateSystem',
    scale: true,
    scaleSize: kind === 'area' ? 6 : 8,
    lineStyle: { width: lineWidth + 1.5 },
    itemStyle: { borderWidth: 2, borderColor: CHART_COLORS.background },
  };
};

export const getBaseLegendConfig = (showLegend: boolean, type: string, config?: ChartConfig) => {
  const position = config?.legendPosition || (showLegend ? 'top' : 'hide');
  const feedPreview = config?.isFeedPreview === true;

  if (position === 'hide') {
    return { show: false };
  }

  const base = {
    show: true,
    icon: 'circle',
    itemWidth: feedPreview ? 7 : 10,
    itemHeight: feedPreview ? 7 : 10,
    itemGap: feedPreview ? 10 : 24,
    textStyle: {
      color:
        config?.axisLabelColor === 'default'
          ? CHART_COLORS.text.secondary
          : (config?.axisLabelColor ?? CHART_COLORS.text.secondary),
      fontSize: config?.legendFontSize ?? config?.axisLabelFontSize ?? 12,
      fontWeight: config?.legendFontWeight ?? 'normal',
    },
    type: 'scroll',
  };

  const layoutMap = {
    top: { top: feedPreview ? 0 : 5, left: feedPreview ? 4 : 10, orient: 'horizontal' },
    bottom: { bottom:5, left: 10, orient: 'horizontal' },
    left: { left: 5, top: 'middle', orient: 'vertical' },
    right: { right: 5, top: 'middle', orient: 'vertical' },
  };

  const layout = layoutMap[position as keyof typeof layoutMap] || layoutMap.top;

  return {
    ...base,
    ...layout,
  };
};

export const getBaseGridConfig = (config: ChartConfig, data?: ChartData) => {
  const compact = config.isDashboardWidget === true;
  const feedPreview = config.isFeedPreview === true;
  const legendPos = config.legendPosition || (config.showLegend !== false ? 'top' : 'hide');
  const showXAxisLabels = (config.showHAxisLabels ?? config.showAxis) !== false;
  const showYAxisLabels = (config.showVAxisLabels ?? config.showAxis) !== false;
  const yAxisFontSize = config.vAxisFontSize ?? config.axisLabelFontSize ?? 11;
  const hasSecondary = data?.secondarySeries && data.secondarySeries.length > 0;
  const secondaryName = config.yAxisSecondaryLabel !== undefined ? config.yAxisSecondaryLabel : (hasSecondary ? data.secondarySeries?.[0]?.name : '');

  const xAxisLabelSlanted =
    config.hAxisLabelSlant === 'up' ||
    config.hAxisLabelSlant === 'down' ||
    config.hAxisLabelSlant === 'right-diagonal' ||
    config.hAxisLabelSlant === 'left-diagonal';

  const yAxisLabelSlanted =
    config.vAxisLabelSlant === 'up' ||
    config.vAxisLabelSlant === 'down' ||
    config.vAxisLabelSlant === 'right-diagonal' ||
    config.vAxisLabelSlant === 'left-diagonal';

  // Base distances — slightly leaner in dashboard tiles; containLabel still expands for labels
  const pad = compact ? 4 : 0;
  const baseBottom =
    (legendPos === 'bottom' ? 40 : config.xAxisLabel ? 45 : feedPreview ? 14 : compact ? 22 : 20) + pad;
  const baseLeft =
    (legendPos === 'left' ? 80 : config.yAxisLabel ? 50 : compact ? 16 : 20) + pad;
  const baseTop =
    (legendPos === 'top' ? (feedPreview ? 20 : compact ? 38 : 45) : feedPreview ? 4 : compact ? 14 : 20) + pad;
  const baseRight = (legendPos === 'right' ? 80 : feedPreview ? 6 : compact ? 14 : 20) + pad;

  const extraBottom = showXAxisLabels ? (xAxisLabelSlanted ? (compact ? 18 : 14) : compact ? 10 : 8) : 0;
  const extraLeft = showYAxisLabels
    ? yAxisLabelSlanted
      ? Math.max(22, Math.round(yAxisFontSize * 2.1)) + (compact ? 4 : 0)
      : Math.max(10, Math.round(yAxisFontSize)) + (compact ? 2 : 0)
    : 0;

  const extraRight = secondaryName && secondaryName !== '' ? 45 : 0;

  return {
    top: config.gridTop ?? baseTop,
    bottom: config.gridBottom ?? baseBottom + extraBottom,
    left: config.gridLeft ?? baseLeft + extraLeft,
    right: config.gridRight ?? baseRight + extraRight,
    containLabel: true,
  };
};

export const getXAxisConfig = (data: ChartData, config: ChartConfig, chartType: string = 'bar') => {
  const compact = config.isDashboardWidget === true;
  const isHorizontalBar = config.barChartType === 'horizontal';
  const isPercentStacked = config.barStackMode === 'stacked-100' || config.lineStackMode === 'stacked-100';
  const isScatter = chartType === 'scatter';
  const hasXAxisTextDecoration = !!(config.hAxisUnderline || config.hAxisStrikethrough);

  return {
    type: isHorizontalBar || isScatter ? 'value' : 'category',
    name: config.xAxisLabel,
    nameLocation: 'middle',
    nameGap: compact ? 22 : 30,
    nameTextStyle: {
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.muted
          : (config.axisLabelColor ?? CHART_COLORS.text.muted),
      fontSize: config.axisLabelFontSize ?? 12,
    },
    data: isHorizontalBar || isScatter ? undefined : data?.x || [],
    min: isHorizontalBar && isPercentStacked ? 0 : undefined,
    max: isHorizontalBar && isPercentStacked ? 100 : undefined,
    axisLine: {
      show: config.showHAxisLine ?? config.showAxis,
      lineStyle: { color: CHART_COLORS.border.light },
    },
    axisLabel: {
      show: config.showHAxisLabels ?? config.showAxis,
      color:
        config.hAxisColor ??
        (config.axisLabelColor === 'default'
          ? CHART_COLORS.text.secondary
          : (config.axisLabelColor ?? CHART_COLORS.text.secondary)),
      fontSize: config.hAxisFontSize ?? config.axisLabelFontSize ?? 11,
      fontWeight: config.hAxisBold ? 'bold' : 'normal',
      fontStyle: config.hAxisItalic ? 'italic' : 'normal',
      rotate:
        config.hAxisLabelSlant === 'up'
          ? -90
          : config.hAxisLabelSlant === 'down'
            ? 90
            : config.hAxisLabelSlant === 'right-diagonal'
              ? 45
              : config.hAxisLabelSlant === 'left-diagonal'
                ? -45
                : 0,
      margin: compact ? 6 : 12,
      interval: isHorizontalBar ? undefined : 'auto', // Auto-hide labels if they don't fit
      hideOverlap: !isHorizontalBar, // explicit hide overlap
      overflow: isHorizontalBar ? undefined : hasXAxisTextDecoration ? 'none' : 'break',
      width: isHorizontalBar ? undefined : hasXAxisTextDecoration ? undefined : compact ? undefined : 80,
      formatter: (value: any) => {
        const baseText = isHorizontalBar
          ? isPercentStacked && typeof value === 'number'
            ? `${value}%`
            : config.valueFormat && config.valueFormat !== 'auto'
              ? formatByValueFormat(value, config.valueFormat)
              : formatAxisLabel(value)
          : `${value ?? ''}`;

        return hasXAxisTextDecoration
          ? applyTextDecorations(baseText, config.hAxisUnderline, config.hAxisStrikethrough)
          : baseText;
      },
    },
    axisTick: { show: false },
    splitLine: {
      show: isHorizontalBar || isScatter ? config.showGridline !== false : false,
      lineStyle: {
        ...CHART_GRID_LINE_STYLE,
        opacity: config.gridLineOpacity ?? 0.6,
      },
    },
  };
};

export const getYAxisConfig = (config: ChartConfig, data?: ChartData) => {
  const compact = config.isDashboardWidget === true;
  const isHorizontalBar = config.barChartType === 'horizontal';
  const isPercentStacked = config.barStackMode === 'stacked-100' || config.lineStackMode === 'stacked-100';
  const hasYAxisTextDecoration = !!(config.vAxisUnderline || config.vAxisStrikethrough);
  const yAxisLabelSlanted =
    config.vAxisLabelSlant === 'up' ||
    config.vAxisLabelSlant === 'down' ||
    config.vAxisLabelSlant === 'right-diagonal' ||
    config.vAxisLabelSlant === 'left-diagonal';
  const hasYTitle = config.yAxisLabel !== undefined || (data?.series && data.series.length > 0);

  return {
    type: isHorizontalBar ? 'category' : 'value',
    name: config.yAxisLabel,
    nameLocation: 'middle',
    nameGap: isHorizontalBar ? (hasYTitle ? 55 : 45) : compact ? 34 : 42,
    nameRotate: 90,
    nameTextStyle: {
      color:
        config.axisLabelColor === 'default'
          ? CHART_COLORS.text.muted
          : (config.axisLabelColor ?? CHART_COLORS.text.muted),
      fontSize: config.axisLabelFontSize ?? 12,
    },
    data: isHorizontalBar ? data?.x || [] : undefined,
    splitNumber: isHorizontalBar ? undefined : 6,
    min: isPercentStacked && !isHorizontalBar ? 0 : undefined,
    max: isPercentStacked && !isHorizontalBar ? 100 : undefined,
    splitLine: {
      show: isHorizontalBar ? false : config.showGridline !== false,
      lineStyle: {
        ...CHART_GRID_LINE_STYLE,
        opacity: config.gridLineOpacity ?? 0.6,
      },
    },
    axisLine: {
      show: config.showVAxisLine ?? false, // Default to false for cleaner look as before
      lineStyle: { color: CHART_COLORS.border.light },
    },
    axisLabel: {
      show: config.showVAxisLabels ?? config.showAxis,
      color:
        config.vAxisColor ??
        (config.axisLabelColor === 'default'
          ? CHART_COLORS.text.muted
          : (config.axisLabelColor ?? CHART_COLORS.text.muted)),
      fontSize: config.vAxisFontSize ?? config.axisLabelFontSize ?? 11,
      fontWeight: config.vAxisBold ? 'bold' : 'normal',
      fontStyle: config.vAxisItalic ? 'italic' : 'normal',
      rotate:
        config.vAxisLabelSlant === 'up'
          ? -90
          : config.vAxisLabelSlant === 'down'
            ? 90
            : config.vAxisLabelSlant === 'right-diagonal'
              ? 45
              : config.vAxisLabelSlant === 'left-diagonal'
                ? -45
                : 0,
      formatter: (value: any) => {
        const baseText = isHorizontalBar
          ? `${value ?? ''}`
          : isPercentStacked && typeof value === 'number'
            ? `${value}%`
            : config.valueFormat && config.valueFormat !== 'auto'
              ? formatByValueFormat(value, config.valueFormat)
              : formatAxisLabel(value);

        return hasYAxisTextDecoration
          ? applyTextDecorations(baseText, config.vAxisUnderline, config.vAxisStrikethrough)
          : baseText;
      },
      margin: compact ? 8 : yAxisLabelSlanted ? 16 : 12,
      interval: isHorizontalBar ? 0 : undefined, // Show all labels for horizontal bars
      hideOverlap: !isHorizontalBar,
      overflow: isHorizontalBar ? (hasYAxisTextDecoration ? 'none' : 'truncate') : undefined,
      width: isHorizontalBar ? (hasYAxisTextDecoration ? undefined : 50) : undefined,
    },
    axisTick: { show: false },
  };
};
