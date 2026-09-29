/**
 * Where data labels sit, as the author chose it per chart type (Power BI "position" / Excel
 * "label position"): bars at the outside end, inside the end or in the center; lines above or
 * below the point; pie slices outside or inside. Applied last, so it wins over older settings.
 */

export type DataLabelPosition = 'end' | 'inside' | 'center' | 'above' | 'below' | 'outside';

type AnyOption = Record<string, any>;

/** The choices that make sense for a chart type, first = default. */
export function dataLabelPositionsFor(chartType: string): DataLabelPosition[] {
  if (chartType === 'bar') return ['end', 'inside', 'center'];
  if (chartType === 'line' || chartType === 'area') return ['above', 'below'];
  if (chartType === 'pie' || chartType === 'donut') return ['outside', 'inside'];
  return [];
}

/** Muted chart text, readable on the light and dark canvas. */
const CHART_TEXT = '#6b7280';

const ON_BAR = { color: '#fff', textBorderColor: 'rgba(0,0,0,0.35)', textBorderWidth: 2 };

export function applyDataLabelPosition(
  option: AnyOption,
  chartType: string,
  config: { dataLabelPosition?: DataLabelPosition; barChartType?: string; design?: { labels?: { valueOnBar?: boolean } } },
): AnyOption {
  if (!Array.isArray(option?.series)) return option;
  const chosen = config.dataLabelPosition;
  const horizontal = config.barChartType === 'horizontal';
  const legacyInside = config.design?.labels?.valueOnBar === true;

  const series = option.series.map((s: AnyOption) => {
    if (!s || !s.label || String(s.id || '').startsWith('aiser-')) return s;
    if (s.type === 'bar') {
      // Unset: outside end (was "inside" on horizontal bars, where the value vanished into the bar);
      // stacked segments label their center.
      const pos = chosen ?? (legacyInside ? 'inside' : s.stack ? 'center' : 'end');
      if (!chosen && legacyInside) return s; // the older "value on bar" style already placed it
      const position =
        pos === 'inside' ? (horizontal ? 'insideRight' : 'insideTop') : pos === 'center' ? 'inside' : horizontal ? 'right' : 'top';
      const onBar = pos === 'inside' || pos === 'center';
      return {
        ...s,
        label: {
          ...s.label,
          position,
          // Outside the bar: the chart's normal text color, no outline (an explicit undefined color
          // made the renderer fall back to white-with-outline).
          ...(onBar ? ON_BAR : { color: s.label.color === '#fff' ? CHART_TEXT : s.label.color, textBorderWidth: 0 }),
        },
        // Labels wider than their bar would run into the next one: drop those that collide.
        labelLayout: { ...(s.labelLayout || {}), hideOverlap: true },
      };
    }
    if (s.type === 'line' && (chosen === 'above' || chosen === 'below')) {
      return { ...s, label: { ...s.label, position: chosen === 'above' ? 'top' : 'bottom' } };
    }
    if (s.type === 'pie' && (chosen === 'outside' || chosen === 'inside')) {
      return {
        ...s,
        label: { ...s.label, position: chosen, ...(chosen === 'inside' ? ON_BAR : {}) },
        labelLine: { ...(s.labelLine || {}), show: chosen === 'outside' },
      };
    }
    return s;
  });
  return { ...option, series };
}

/**
 * The value axis's start and end when the author set them (Power BI "Start" / "End"); blank
 * keeps the automatic range. The value axis is Y, or X on a horizontal bar.
 */
export function applyValueAxisRange(
  option: AnyOption,
  config: { valueAxisMin?: number; valueAxisMax?: number },
): AnyOption {
  const min = typeof config.valueAxisMin === 'number' ? config.valueAxisMin : undefined;
  const max = typeof config.valueAxisMax === 'number' ? config.valueAxisMax : undefined;
  if (min === undefined && max === undefined) return option;
  const patch = (axis: unknown) => {
    const list = Array.isArray(axis) ? axis : axis ? [axis] : [];
    if (!list.length) return axis;
    const i = list.findIndex((a: AnyOption) => a?.type === 'value' || a?.type === 'log');
    if (i < 0) return axis;
    const next = [...list];
    next[i] = { ...next[i], ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    return Array.isArray(axis) ? next : next[0];
  };
  const yHasValues = (Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]).some(
    (a: AnyOption) => a?.type === 'value' || a?.type === 'log',
  );
  return yHasValues ? { ...option, yAxis: patch(option.yAxis) } : { ...option, xAxis: patch(option.xAxis) };
}
