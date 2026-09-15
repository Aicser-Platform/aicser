/**
 * Forecast charts must stay on native ECharts (Historical + dashed Forecast).
 * Shared WidgetRenderer flattens them to the last SQL table.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function plotValueFromForecastPoint(raw: unknown): number | null {
  if (raw == null || raw === '' || raw === '-') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const v = (raw as { value?: unknown }).value;
    if (v != null && typeof v === 'object' && !Array.isArray(v) && v !== null && 'value' in v) {
      return plotValueFromForecastPoint((v as { value?: unknown }).value);
    }
    return plotValueFromForecastPoint(v);
  }
  if (Array.isArray(raw)) {
    const n = Number(raw[1] ?? raw[0]);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function formatForecastAxisDate(val: string, monthly: boolean): string {
  const m = String(val || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return val;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3] || '1');
  if (month < 1 || month > 12) return val;
  const mon = MONTHS[month - 1];
  if (monthly || !m[3] || day === 1) return `${mon} ${year}`;
  return `${day} ${mon} ${year}`;
}

export function forecastAxisLooksMonthly(dates: string[]): boolean {
  if (dates.length < 2) return dates.some((d) => /^\d{4}-\d{2}-01$/.test(String(d).slice(0, 10)));
  const keys = dates
    .map((d) => String(d).match(/^(\d{4})-(\d{2})/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1]}-${m[2]}`);
  if (keys.length !== dates.length) return false;
  return new Set(keys).size === dates.length;
}

export function forecastTooltipHtml(params: unknown): string {
  const list = Array.isArray(params) ? params : params != null ? [params] : [];
  if (!list.length) return '';
  const first = list[0] as { axisValue?: unknown; axisValueLabel?: unknown };
  const date = String(first?.axisValueLabel || first?.axisValue || '');
  let html = `<div><b>${date}</b></div>`;
  for (const item of list) {
    const p = item as {
      marker?: string;
      seriesName?: string;
      value?: unknown;
      data?: { value?: unknown; lower?: unknown; upper?: unknown } | unknown;
    };
    const dataObj =
      p.data != null && typeof p.data === 'object' && !Array.isArray(p.data)
        ? (p.data as { value?: unknown; lower?: unknown; upper?: unknown })
        : null;
    const v = plotValueFromForecastPoint(dataObj ?? p.value);
    if (v == null) continue;
    const seriesName = String(p.seriesName || '');
    if (seriesName === '_ci_lower' || seriesName === '95% interval') continue;
    html += `<div>${p.marker || ''} <span style="font-weight:500">${seriesName}:</span> <b>${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>`;
    if (
      String(p.seriesName || '') === 'Forecast' &&
      dataObj &&
      dataObj.lower != null &&
      dataObj.upper != null
    ) {
      const lo = Number(dataObj.lower);
      const hi = Number(dataObj.upper);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        html += `<div style="opacity:0.75">95% interval: ${lo.toLocaleString(undefined, { maximumFractionDigits: 2 })} – ${hi.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>`;
      }
    }
  }
  return html;
}

/** Apply display polish that cannot travel as a JSON function string. */
export function polishForecastEchartsOption(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  const xAxisRaw = next.xAxis;
  const xAxis = (Array.isArray(xAxisRaw) ? xAxisRaw[0] : xAxisRaw) as Record<string, unknown> | undefined;
  const dates = Array.isArray(xAxis?.data) ? (xAxis.data as unknown[]).map((d) => String(d ?? '')) : [];
  const monthly = forecastAxisLooksMonthly(dates);

  if (xAxis && typeof xAxis === 'object') {
    const labeled = {
      ...xAxis,
      axisLabel: {
        ...((xAxis.axisLabel as Record<string, unknown>) || {}),
        hideOverlap: true,
        formatter: (val: string) => formatForecastAxisDate(String(val), monthly),
      },
    };
    next.xAxis = Array.isArray(xAxisRaw) ? [labeled, ...xAxisRaw.slice(1)] : labeled;
  }

  next.tooltip = {
    ...((next.tooltip as Record<string, unknown>) || {}),
    trigger: 'axis',
    axisPointer: { type: 'cross' },
    formatter: forecastTooltipHtml,
  };

  const titleHidden =
    next.title &&
    typeof next.title === 'object' &&
    (next.title as { show?: boolean }).show === false;

  next.grid = {
    left: '8%',
    right: '5%',
    ...((next.grid && typeof next.grid === 'object' ? next.grid : {}) as Record<string, unknown>),
    top: titleHidden ? 40 : 78,
    bottom: 56,
    containLabel: true,
  };

  const legend = next.legend;
  const seriesList = Array.isArray(next.series) ? (next.series as Record<string, unknown>[]) : [];
  const legendData: Array<string | { name: string; icon?: string }> = ['Historical', 'Forecast'];
  if (seriesList.some((s) => s?.name === '95% interval')) {
    legendData.push({ name: '95% interval', icon: 'roundRect' });
  }
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    next.legend = {
      ...(legend as Record<string, unknown>),
      top: titleHidden ? 8 : (legend as { top?: unknown }).top ?? 44,
      data: legendData,
    };
  }

  // Ensure CI stack + areaStyle survive any client remaps.
  next.series = seriesList.map((s) => {
    const name = String(s?.name || '');
    if (name !== '_ci_lower' && name !== '95% interval' && s?.stack !== 'ci') return s;
    const helper = { ...s, type: 'line', symbol: 'none', stack: 'ci', stackStrategy: s.stackStrategy || 'all' };
    if (name === '_ci_lower') {
      helper.lineStyle = { opacity: 0, width: 0, color: 'transparent', ...((s.lineStyle as object) || {}) };
      helper.areaStyle = { opacity: 0, color: 'transparent' };
      helper.itemStyle = { opacity: 0, color: 'transparent', ...((s.itemStyle as object) || {}) };
    } else {
      helper.lineStyle = { opacity: 0, width: 0, ...((s.lineStyle as object) || {}) };
      helper.areaStyle = {
        color: 'rgba(145, 204, 117, 0.35)',
        ...((s.areaStyle as object) || {}),
      };
    }
    return helper;
  });

  if (Array.isArray(next.color)) {
    const colors = [...(next.color as unknown[])];
    if (colors.length >= 4) {
      colors[2] = 'transparent';
      colors[3] = 'rgba(145, 204, 117, 0.55)';
      next.color = colors;
    }
  }

  delete next._forecastTooltip;
  return next;
}
