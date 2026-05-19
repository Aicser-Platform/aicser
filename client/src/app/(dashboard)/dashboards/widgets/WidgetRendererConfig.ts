/**
 * Configuration for chart rendering
 * Centralized colors, defaults, and chart settings
 */

import { formatAxisLabel } from '../utils/numberFormatter';

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
}

export interface ChartData {
  x: any[];
  y: any[];
  series?: { name: string; data: any[] }[];
  secondarySeries?: { name: string; data: any[] }[];
  group_field?: any[];
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

export const getBaseTooltipConfig = (type: string) => ({
  trigger: ['pie', 'donut', 'funnel', 'heatmap'].includes(type) ? 'item' : 'axis',
  confine: true, // Keep tooltip within chart area
  backgroundColor: isDark() ? '#161b22' : '#fff',
  borderRadius: 8,
  padding: 12,
  textStyle: { color: CHART_COLORS.text.primary, fontSize: 12 },
  extraCssText: `box-shadow: 0 4px 12px rgba(0,0,0,${isDark() ? '0.3' : '0.08'}); border: 1px solid ${CHART_COLORS.border.light};`,
});

export const getBaseLegendConfig = (showLegend: boolean, type: string, config?: ChartConfig) => {
  const position = config?.legendPosition || (showLegend ? 'top' : 'hide');

  if (position === 'hide') {
    return { show: false };
  }

  const base = {
    show: true,
    icon: 'circle',
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 24,
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
    top: { top: 5, left: 10, orient: 'horizontal' },
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

  // Base distances based on legend position and labels
  const baseBottom = legendPos === 'bottom' ? 40 : config.xAxisLabel ? 45 : 20;
  const baseLeft = legendPos === 'left' ? 80 : config.yAxisLabel ? 50 : 20;
  const baseTop = legendPos === 'top' ? 45 : 20;
  const baseRight = legendPos === 'right' ? 80 : 20;

  // Add extra for slanted labels or specific font sizes
  const extraBottom = showXAxisLabels ? (xAxisLabelSlanted ? 14 : 8) : 0;
  const extraLeft = showYAxisLabels
    ? yAxisLabelSlanted
      ? Math.max(22, Math.round(yAxisFontSize * 2.1))
      : Math.max(10, Math.round(yAxisFontSize))
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
  const isHorizontalBar = config.barChartType === 'horizontal';
  const isPercentStacked = config.barStackMode === 'stacked-100' || config.lineStackMode === 'stacked-100';
  const isScatter = chartType === 'scatter';
  const hasXAxisTextDecoration = !!(config.hAxisUnderline || config.hAxisStrikethrough);

  return {
    type: isHorizontalBar || isScatter ? 'value' : 'category',
    name: config.xAxisLabel,
    nameLocation: 'middle',
    nameGap: 30,
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
      margin: 12,
      interval: isHorizontalBar ? undefined : 'auto', // Auto-hide labels if they don't fit
      hideOverlap: !isHorizontalBar, // explicit hide overlap
      overflow: isHorizontalBar ? undefined : hasXAxisTextDecoration ? 'none' : 'break', // Disable break for decorated text
      width: isHorizontalBar ? undefined : hasXAxisTextDecoration ? undefined : 80,
      formatter: (value: any) => {
        const baseText = isHorizontalBar
          ? isPercentStacked && typeof value === 'number'
            ? `${value}%`
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
        color: '#d1d5db',
        type: 'dashed',
        opacity: config.gridLineOpacity ?? 0.6,
        width: 1,
      },
    },
  };
};

export const getYAxisConfig = (config: ChartConfig, data?: ChartData) => {
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
    nameGap: isHorizontalBar ? (hasYTitle ? 55 : 45) : 42,
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
        color: '#d1d5db',
        type: 'dashed',
        opacity: config.gridLineOpacity ?? 0.6,
        width: 1,
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
            : formatAxisLabel(value);

        return hasYAxisTextDecoration
          ? applyTextDecorations(baseText, config.vAxisUnderline, config.vAxisStrikethrough)
          : baseText;
      },
      margin: yAxisLabelSlanted ? 16 : 12,
      interval: isHorizontalBar ? 0 : undefined, // Show all labels for horizontal bars
      hideOverlap: !isHorizontalBar,
      overflow: isHorizontalBar ? (hasYAxisTextDecoration ? 'none' : 'truncate') : undefined,
      width: isHorizontalBar ? (hasYAxisTextDecoration ? undefined : 50) : undefined,
    },
    axisTick: { show: false },
  };
};
