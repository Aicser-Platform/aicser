import {
  CHART_COLORS,
  getBaseTooltipConfig,
  getCartesianBlur,
  getCartesianEmphasis,
  isDark,
} from '../WidgetRendererConfig';

function inferChartType(option: Record<string, unknown>): string {
  const series = option.series as Array<{ type?: string; areaStyle?: unknown }> | undefined;
  const first = series?.[0];
  if (!first?.type) return 'bar';
  let chartType = String(first.type);
  if (chartType === 'line' && series?.some((s) => s.areaStyle)) chartType = 'area';
  if (chartType === 'pie') {
    const radius = (first as { radius?: unknown }).radius;
    if (Array.isArray(radius) && parseFloat(String(radius[0])) > 0) chartType = 'donut';
  }
  return chartType;
}

function cartesianKind(
  seriesType: string,
  series: { areaStyle?: unknown },
): 'bar' | 'line' | 'area' | null {
  if (seriesType === 'bar') return 'bar';
  if (seriesType === 'line') return series.areaStyle ? 'area' : 'line';
  return null;
}

function themeAxisStyles(option: Record<string, unknown>): Record<string, unknown> {
  const patchAxis = (axis: unknown) => {
    if (!axis || typeof axis !== 'object') return axis;
    const a = axis as Record<string, unknown>;
    return {
      ...a,
      axisLabel: {
        ...(a.axisLabel as Record<string, unknown> | undefined),
        color: CHART_COLORS.text.secondary,
      },
      axisLine: {
        ...(a.axisLine as Record<string, unknown> | undefined),
        lineStyle: {
          ...((a.axisLine as { lineStyle?: Record<string, unknown> } | undefined)?.lineStyle),
          color: CHART_COLORS.border.light,
        },
      },
      splitLine: {
        ...(a.splitLine as Record<string, unknown> | undefined),
        lineStyle: {
          ...((a.splitLine as { lineStyle?: Record<string, unknown> } | undefined)?.lineStyle),
          color: isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          type: 'solid',
        },
      },
    };
  };

  const patchList = (axes: unknown) => {
    if (Array.isArray(axes)) return axes.map(patchAxis);
    if (axes) return patchAxis(axes);
    return axes;
  };

  return {
    xAxis: patchList(option.xAxis),
    yAxis: patchList(option.yAxis),
  };
}

/** Merge dashboard-grade tooltip, theme, and blur into frozen AI/chat ECharts options. */
export function enhanceEchartsInteractivity(
  option: Record<string, unknown>,
  opts?: { suppressCardTitle?: boolean },
): Record<string, unknown> {
  const type = inferChartType(option);
  const tooltipDefaults = getBaseTooltipConfig(type, { appendToBody: true });
  const existingTooltip =
    option.tooltip && typeof option.tooltip === 'object'
      ? (option.tooltip as Record<string, unknown>)
      : {};

  const existingTitle =
    option.title && typeof option.title === 'object'
      ? (option.title as Record<string, unknown>)
      : typeof option.title === 'string'
        ? { text: option.title }
        : {};

  const enhanced: Record<string, unknown> = {
    ...option,
    ...themeAxisStyles(option),
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipDefaults,
      ...existingTooltip,
      axisPointer: {
        ...(tooltipDefaults.axisPointer as Record<string, unknown> | undefined),
        ...((existingTooltip.axisPointer as Record<string, unknown> | undefined) ?? {}),
      },
    },
    legend:
      option.legend && typeof option.legend === 'object'
        ? {
            ...(option.legend as Record<string, unknown>),
            textStyle: {
              ...((option.legend as { textStyle?: Record<string, unknown> }).textStyle),
              color: CHART_COLORS.text.secondary,
            },
          }
        : option.legend,
    title:
      opts?.suppressCardTitle === false
        ? option.title
        : { ...existingTitle, show: false },
    stateAnimation: {
      duration: 200,
      easing: 'cubicOut',
      ...(option.stateAnimation as Record<string, unknown> | undefined),
    },
  };

  const series = option.series;
  if (!Array.isArray(series)) return enhanced;

  enhanced.series = series.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const s = entry as Record<string, unknown>;
    const seriesType = String(s.type || type);
    const kind = cartesianKind(seriesType, s as { areaStyle?: unknown });
    if (!kind) return entry;

    return {
      ...s,
      emphasis: {
        ...(s.emphasis as Record<string, unknown> | undefined),
        ...getCartesianEmphasis(kind, 3),
      },
      blur: {
        ...(s.blur as Record<string, unknown> | undefined),
        ...getCartesianBlur(),
      },
    };
  });

  return enhanced;
}
