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
  const hourly = String(val || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (hourly) {
    const mi = Number(hourly[2]);
    if (mi >= 1 && mi <= 12) return `${Number(hourly[3])} ${MONTHS[mi - 1]} ${hourly[4]}:${hourly[5]}`;
  }
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

/** Invisible stack bases and band fills — never listed in the tooltip. */
const CI_HELPER_NAMES = new Set(['_ci_lower', '95% interval', '_ci80_lower', '80% interval']);

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
    if (CI_HELPER_NAMES.has(seriesName)) continue;
    const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (seriesName === 'In progress') {
      const cov = (dataObj as { coverage_pct?: unknown } | null)?.coverage_pct;
      const covTxt = cov != null && Number.isFinite(Number(cov)) ? ` (${Number(cov)}% complete)` : '';
      html += `<div>${p.marker || ''} <span style="font-weight:500">In progress${covTxt}:</span> <b>${fmt(v)}</b></div>`;
      continue;
    }
    html += `<div>${p.marker || ''} <span style="font-weight:500">${seriesName}:</span> <b>${fmt(v)}</b></div>`;
    if (seriesName === 'Forecast' && dataObj) {
      const band = dataObj as { lower?: unknown; upper?: unknown; lower_80?: unknown; upper_80?: unknown };
      const lo80 = Number(band.lower_80);
      const hi80 = Number(band.upper_80);
      if (band.lower_80 != null && band.upper_80 != null && Number.isFinite(lo80) && Number.isFinite(hi80)) {
        html += `<div style="opacity:0.75">80% interval: ${fmt(lo80)} – ${fmt(hi80)}</div>`;
      }
      const lo = Number(band.lower);
      const hi = Number(band.upper);
      if (band.lower != null && band.upper != null && Number.isFinite(lo) && Number.isFinite(hi)) {
        html += `<div style="opacity:0.75">95% interval: ${fmt(lo)} – ${fmt(hi)}</div>`;
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
  if (seriesList.some((s) => s?.name === '80% interval')) {
    legendData.push({ name: '80% interval', icon: 'roundRect' });
  }
  if (seriesList.some((s) => s?.name === '95% interval')) {
    legendData.push({ name: '95% interval', icon: 'roundRect' });
  }
  if (seriesList.some((s) => s?.name === 'In progress')) {
    legendData.push('In progress');
  }
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    next.legend = {
      ...(legend as Record<string, unknown>),
      top: titleHidden ? 8 : (legend as { top?: unknown }).top ?? 44,
      data: legendData,
    };
  }

  // Ensure CI stacks + areaStyle survive any client remaps (95% band = stack 'ci',
  // inner 80% band = stack 'ci80').
  next.series = seriesList.map((s) => {
    const name = String(s?.name || '');
    const inner = name === '_ci80_lower' || name === '80% interval' || s?.stack === 'ci80';
    if (!inner && name !== '_ci_lower' && name !== '95% interval' && s?.stack !== 'ci') return s;
    const helper: Record<string, unknown> = {
      ...s,
      type: 'line',
      symbol: 'none',
      stack: inner ? 'ci80' : 'ci',
      stackStrategy: s.stackStrategy || 'all',
    };
    if (name === '_ci_lower' || name === '_ci80_lower') {
      helper.lineStyle = { opacity: 0, width: 0, color: 'transparent', ...((s.lineStyle as object) || {}) };
      helper.areaStyle = { opacity: 0, color: 'transparent' };
      helper.itemStyle = { opacity: 0, color: 'transparent', ...((s.itemStyle as object) || {}) };
    } else {
      helper.lineStyle = { opacity: 0, width: 0, ...((s.lineStyle as object) || {}) };
      helper.areaStyle = {
        color: inner ? 'rgba(145, 204, 117, 0.45)' : 'rgba(145, 204, 117, 0.35)',
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
      if (colors.length >= 6) {
        colors[4] = 'transparent';
        colors[5] = 'rgba(145, 204, 117, 0.7)';
      }
      next.color = colors;
    }
  }

  delete next._forecastTooltip;
  return next;
}
