/**
 * Option builders for the chart types that aren't a plain category × number grid: sankey,
 * histogram, waterfall, bullet, funnel, treemap and heatmap. Each returns the parts of an
 * ECharts option it owns (series, axes, tooltip…); ChartOptionsBuilder merges them and runs the
 * shared finishing steps (design, labels, text styles, notes, colour overrides).
 */
import type { ChartData } from './WidgetRendererConfig';
import { CHART_COLORS } from './WidgetRendererConfig';

/** Words these charts draw themselves; translated by the widget, English as a fallback. */
export type ChartText = {
  increase: string;
  decrease: string;
  total: string;
  actual: string;
  target: string;
  count: string;
  ofTop: string; // "{pct} of top"
  ofPrevious: string; // "{pct} of previous"
  ofTotal: string; // "{pct} of total"
  rows: string; // "{count} rows"
};

export const DEFAULT_CHART_TEXT: ChartText = {
  increase: 'Increase',
  decrease: 'Decrease',
  total: 'Total',
  actual: 'Actual',
  target: 'Target',
  count: 'Count',
  ofTop: '{pct} of top',
  ofPrevious: '{pct} of previous',
  ofTotal: '{pct} of total',
  rows: '{count} rows',
};

type Fmt = (v: number) => string;
type Parts = Record<string, unknown>;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const pct = (part: number, whole: number) =>
  whole ? `${(part / whole * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : '–';
const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The numbers of a one-measure chart, whether the server sent `y` or `series[0]`. */
export function primaryValues(data: ChartData): number[] {
  if (Array.isArray(data.y) && data.y.length) return data.y.map(num);
  const s = data.series?.[0]?.data;
  return Array.isArray(s) ? s.map((v) => num(Array.isArray(v) ? v[v.length - 1] : v)) : [];
}

// ─── Sankey ─────────────────────────────────────────────────────────────────

const MAX_SANKEY_LINKS = 120;

/**
 * Flows from one column to another (x → group_field, sized by y). The two columns name different
 * things, so a value that appears in both ("Cash" as account and as category) becomes two nodes —
 * one flow can't loop back on itself, which ECharts can't draw.
 */
export function sankeyParts(data: ChartData, colors: string[], fmt: Fmt, text: ChartText): Parts {
  const sources = (data.x || []).map(String);
  const targets = ((data as { group_field?: unknown[] }).group_field || []).map(String);
  const values = primaryValues(data);
  const sourceSet = new Set(sources);
  const targetId = (t: string) => (sourceSet.has(t) ? `${t}​` : t);

  const merged = new Map<string, { source: string; target: string; value: number }>();
  sources.forEach((s, i) => {
    const t = targets[i];
    const v = values[i];
    if (t === undefined || !(v > 0)) return; // flows are positive amounts
    const key = `${s}\u0000${t}`;
    const cur = merged.get(key);
    if (cur) cur.value += v;
    else merged.set(key, { source: s, target: targetId(t), value: v });
  });
  const links = [...merged.values()].sort((a, b) => b.value - a.value).slice(0, MAX_SANKEY_LINKS);

  const totals = new Map<string, number>();
  for (const l of links) {
    totals.set(l.source, (totals.get(l.source) || 0) + l.value);
    totals.set(l.target, (totals.get(l.target) || 0) + l.value);
  }
  const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
  const nodes = names.map((name, i) => ({ name, itemStyle: { color: colors[i % colors.length] } }));
  const shown = (name: string) => name.replace(/​$/, '');
  const grand = links.reduce((sum, l) => sum + l.value, 0);

  return {
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { dataType?: string; data?: { source?: string; target?: string; value?: number }; name?: string }) => {
        if (p.dataType === 'edge' && p.data) {
          return `${esc(shown(p.data.source || ''))} → ${esc(shown(p.data.target || ''))}<br/><strong>${esc(fmt(num(p.data.value)))}</strong> · ${esc(fill(text.ofTotal, { pct: pct(num(p.data.value), grand) }))}`;
        }
        const total = totals.get(p.name || '') || 0;
        return `${esc(shown(p.name || ''))}<br/><strong>${esc(fmt(total))}</strong>`;
      },
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        // Destination labels sit right of their nodes: keep room so they aren't clipped.
        right: 130,
        top: 8,
        bottom: 8,
        nodeGap: 10,
        nodeWidth: 14,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
        label: {
          color: CHART_COLORS.text.secondary,
          textBorderWidth: 0,
          fontSize: 11,
          width: 120,
          overflow: 'truncate',
          formatter: (p: { name: string }) => shown(p.name),
        },
        data: nodes,
        links,
      },
    ],
    legend: { show: false },
  };
}

// ─── Histogram ──────────────────────────────────────────────────────────────

/** Touching bars over value ranges; labels read "1,000–2,000". Counts every row, not a sample. */
export function histogramParts(data: ChartData, color: string, fmt: Fmt, text: ChartText): Parts {
  const bins = ((data as { bins?: number[][] }).bins || []).filter((b) => Array.isArray(b) && b.length === 2);
  const counts = primaryValues(data);
  const total = counts.reduce((a, b) => a + b, 0);
  const labels = bins.map(([lo, hi]) => `${fmt(lo)}–${fmt(hi)}`);
  return {
    categories: labels,
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { dataIndex: number }) => {
        const c = counts[p.dataIndex] ?? 0;
        return `${esc(labels[p.dataIndex])}<br/><strong>${esc(fill(text.rows, { count: c.toLocaleString() }))}</strong> · ${esc(fill(text.ofTotal, { pct: pct(c, total) }))}`;
      },
    },
    series: [
      {
        name: text.count,
        type: 'bar',
        data: counts,
        barCategoryGap: '2%',
        itemStyle: { color, borderRadius: 0 },
      },
    ],
    legend: { show: false },
  };
}

// ─── Waterfall ──────────────────────────────────────────────────────────────

type WaterfallItem = { index: number; start: number; end: number; delta: number; kind: 'up' | 'down' | 'total' };

/**
 * Each step floats from the running total before it to the one after, so a run that dips below
 * zero still draws correctly (stacked invisible bars can't), and a Total bar closes the story.
 */
export function waterfallItems(values: number[], withTotal: boolean): WaterfallItem[] {
  let running = 0;
  const items: WaterfallItem[] = values.map((delta, index) => {
    const start = running;
    running += delta;
    return { index, start, end: running, delta, kind: delta >= 0 ? 'up' : 'down' };
  });
  if (withTotal && values.length) items.push({ index: values.length, start: 0, end: running, delta: running, kind: 'total' });
  return items;
}

export function waterfallParts(
  data: ChartData,
  colors: { up: string; down: string; total: string },
  fmt: Fmt,
  text: ChartText,
  opts: { showTotal: boolean; showLabels: boolean },
): Parts {
  const cats = (data.x || []).map(String);
  const items = waterfallItems(primaryValues(data), opts.showTotal);
  const categories = opts.showTotal && cats.length ? [...cats, text.total] : cats;
  const names = { up: text.increase, down: text.decrease, total: text.total };

  const series = (['up', 'down', 'total'] as const)
    .filter((kind) => kind !== 'total' || opts.showTotal)
    .map((kind) => ({
      name: names[kind],
      type: 'custom',
      itemStyle: { color: colors[kind] },
      encode: { x: 0, y: [1, 2] },
      data: items.filter((it) => it.kind === kind).map((it) => [it.index, it.start, it.end, it.delta]),
      renderItem: (
        params: unknown,
        api: {
          value: (i: number) => number;
          coord: (v: number[]) => number[];
          size: (v: number[]) => number[];
          style: (extra?: object) => object;
        },
      ) => {
        const i = api.value(0);
        const a = api.coord([i, api.value(1)]);
        const b = api.coord([i, api.value(2)]);
        const w = api.size([1, 0])[0] * 0.6;
        const top = Math.min(a[1], b[1]);
        const h = Math.max(1, Math.abs(a[1] - b[1]));
        const delta = api.value(3);
        return {
          type: 'rect',
          shape: { x: a[0] - w / 2, y: top, width: w, height: h, r: 2 },
          style: api.style(),
          ...(opts.showLabels
            ? {
                textContent: {
                  style: {
                    text: `${kind === 'total' ? '' : delta >= 0 ? '+' : ''}${fmt(delta)}`,
                    fill: CHART_COLORS.text.secondary,
                    fontSize: 11,
                  },
                },
                textConfig: { position: 'top', distance: 4 },
              }
            : {}),
        };
      },
    }));

  return {
    categories,
    series,
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { data: number[]; seriesName: string }) => {
        const [i, , end, delta] = p.data;
        const label = categories[i] ?? '';
        if (i >= cats.length) return `${esc(label)}<br/><strong>${esc(fmt(end))}</strong>`;
        return `${esc(label)}<br/><strong>${delta >= 0 ? '+' : ''}${esc(fmt(delta))}</strong><br/>${esc(text.total)}: ${esc(fmt(end))}`;
      },
    },
  };
}

/** Target marker: amber reads on light and dark cards and against any palette colour. */
const TARGET_COLOR = '#e8a33a';

// ─── Bullet ─────────────────────────────────────────────────────────────────

/**
 * Actual vs target per row, over qualitative bands measured as a share of each row's own target
 * (poor below `warnPct`, fair to `okPct`, good beyond) — Stephen Few's bullet graph.
 */
export function bulletParts(
  data: ChartData,
  color: string,
  fmt: Fmt,
  text: ChartText,
  opts: { warnPct: number; okPct: number; max?: number; fixedTarget?: number; actualLabel?: string },
): Parts {
  const categories = (data.x || []).map(String);
  const actuals = primaryValues(data);
  const y2 = (data as { y2?: unknown[] }).y2;
  const fromSeries = data.series?.[1]?.data;
  const targets: Array<number | null> = categories.map((_, i) => {
    if (Array.isArray(y2) && y2[i] != null) return num(y2[i]);
    if (Array.isArray(fromSeries) && fromSeries[i] != null) return num(fromSeries[i]);
    return opts.fixedTarget != null ? opts.fixedTarget : null;
  });
  const hasTargets = targets.some((t) => t != null && t > 0);
  const top = opts.max ?? (Math.max(...actuals, ...targets.map((t) => t ?? 0), 0) * 1.1 || 1);
  const warn = Math.max(0, opts.warnPct) / 100;
  const ok = Math.max(warn, opts.okPct) / 100;
  const band = (from: (t: number) => number, to: (t: number) => number) =>
    targets.map((t) => (t && t > 0 ? Math.max(0, Math.min(top, to(t)) - Math.min(top, from(t))) : 0));
  const bandSeries = hasTargets
    ? [
        band(() => 0, (t) => t * warn),
        band((t) => t * warn, (t) => t * ok),
        band((t) => t * ok, () => top),
      ].map((d, i) => ({
        type: 'bar',
        stack: 'bands',
        barWidth: '70%',
        barGap: '-100%',
        z: 1,
        silent: true,
        tooltip: { show: false },
        // Qualitative bands in shades of grey (Few's bullet graph): readable in both themes and
        // never competing with the actual bar.
        itemStyle: { color: ['rgba(140,150,160,0.42)', 'rgba(140,150,160,0.26)', 'rgba(140,150,160,0.12)'][i], borderRadius: 0 },
        data: d,
      }))
    : [];
  const actualName = opts.actualLabel || text.actual;
  return {
    categories,
    valueMax: top,
    series: [
      ...bandSeries,
      {
        name: actualName,
        type: 'bar',
        barWidth: '35%',
        barGap: '-100%',
        z: 3,
        data: actuals,
        itemStyle: { color },
        label: { show: true, position: 'right', formatter: (p: { value: number }) => fmt(p.value), color: CHART_COLORS.text.secondary, fontSize: 11 },
      },
      // Target: a thin upright marker per row (a scatter mark — reliable on a category axis).
      ...(hasTargets
        ? [{
            name: text.target,
            type: 'scatter',
            z: 4,
            symbol: 'rect',
            symbolSize: [4, 22],
            itemStyle: { color: TARGET_COLOR },
            data: targets.map((t, i) => (t && t > 0 ? [t, i] : null)).filter(Boolean),
          }]
        : []),
    ],
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { dataIndex: number; value?: unknown }) => {
        // Target marks carry [target, row]; bars carry their own row index.
        const i = Array.isArray(p.value) ? Number(p.value[1]) : p.dataIndex;
        const t = targets[i];
        const a = actuals[i] ?? 0;
        return `${esc(categories[i])}<br/>${esc(actualName)}: <strong>${esc(fmt(a))}</strong>${
          t != null && t > 0 ? `<br/>${esc(text.target)}: ${esc(fmt(t))} · ${pct(a, t)}` : ''
        }`;
      },
    },
    legend: { show: false },
  };
}

// ─── Funnel, treemap, heatmap: labels and tooltips that carry meaning ───────

/** Stage labels with each stage's share of the top one; tooltips add the step conversion. */
export function funnelLabels(data: ChartData, fmt: Fmt, text: ChartText): Parts {
  const values = primaryValues(data);
  const names = (data.x || []).map(String);
  const sorted = [...values].sort((a, b) => b - a);
  const topValue = sorted[0] || 0;
  const previous = (v: number) => {
    const i = sorted.indexOf(v);
    return i > 0 ? sorted[i - 1] : undefined;
  };
  return {
    data: names.map((name, i) => ({ name, value: values[i] ?? 0 })),
    label: {
      formatter: (p: { name: string; value: number }) => `${p.name}  ${fmt(p.value)} · ${pct(p.value, topValue)}`,
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { name: string; value: number }) => {
        const prev = previous(p.value);
        return `${esc(p.name)}<br/><strong>${esc(fmt(p.value))}</strong><br/>${esc(fill(text.ofTop, { pct: pct(p.value, topValue) }))}${
          prev ? `<br/>${esc(fill(text.ofPrevious, { pct: pct(p.value, prev) }))}` : ''
        }`;
      },
    },
  };
}

export function treemapLabels(values: number[], fmt: Fmt, text: ChartText): Parts {
  const total = values.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  return {
    label: {
      show: true,
      fontSize: 12,
      lineHeight: 16,
      formatter: (p: { name: string; value: number }) => `${p.name}\n${fmt(p.value)}`,
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { name: string; value: number }) =>
        `${esc(p.name)}<br/><strong>${esc(fmt(p.value))}</strong> · ${esc(fill(text.ofTotal, { pct: pct(p.value, total) }))}`,
    },
  };
}

/** Colour scale over the values actually present (never ±Infinity on empty data). */
export function heatmapScale(values: number[], fmt: Fmt): { min: number; max: number; formatter: (v: number) => string } {
  const finite = values.filter((v) => Number.isFinite(v));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  return { min, max: max === min ? min + 1 : max, formatter: (v: number) => fmt(v) };
}
