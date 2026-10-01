'use client';

import React, { useEffect, useRef } from 'react';
import type { ChartSpec } from '@/services/notebookService';
import { shapeChart, type Agg } from './chartShape';

const PALETTE = ['#0d7a78', '#E69F00', '#0072B2', '#CC79A7', '#009E73', '#D55E00', '#56B4E9', '#7F3C8D', '#8C6D31', '#6B6ECF', '#B5CF6B', '#E7969C'];
const TOP: Record<string, number> = { bar: 25, pie: 10 };
const MAX_SERIES = 12;
const MAX_POINTS = 5000;

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const precise = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
/** Axis ticks: compact only for large numbers — rounding small ones to one decimal made
 * neighbouring ticks read the same (105.1, 105.1, 105, 105). */
const tick = (v: number) => (Math.abs(v) >= 10000 ? compact.format(v) : precise.format(v));
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Room the value-axis name needs to clear the widest tick label beside it. */
function nameGapFor(values: Array<number | null | undefined>): number {
  let widest = 1;
  for (const v of values) if (v != null && Number.isFinite(v)) widest = Math.max(widest, tick(v).length);
  return Math.min(90, Math.max(30, widest * 7 + 16));
}

/** What a chart summarises by default: every row for scatter, otherwise one value per category. */
export function defaultAgg(spec: ChartSpec): Agg {
  return spec.agg ?? (spec.type === 'scatter' ? 'none' : 'sum');
}

/** A chart of a result: rows grouped by the x column and summarised, split by an optional column. */
export function NotebookChart({
  spec, columns, rows, dark, ariaLabel, otherLabel = 'Other', note, noteTop,
}: {
  spec: ChartSpec;
  columns: string[];
  rows: unknown[][];
  dark: boolean;
  ariaLabel: string;
  otherLabel?: string;
  /** Says when categories were folded into Other (pie), e.g. "Top 9 of 1,000 · rest in Other". */
  note?: (shown: number, total: number) => string;
  /** Says when only the top categories are drawn (bars), e.g. "Top 25 of 1,000". */
  noteTop?: (shown: number, total: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !spec.x || (!spec.y?.length && defaultAgg(spec) !== 'count')) return;
    let disposed = false;
    let chart: import('echarts').ECharts | null = null;
    void import('echarts').then((echarts) => {
      if (disposed || !ref.current) return;
      chart = echarts.init(ref.current, dark ? 'dark' : undefined, { renderer: 'canvas' });
      const type = spec.type || 'bar';
      const agg = defaultAgg(spec);
      const text = dark ? '#e7eef0' : '#15212b';
      const shaped = shapeChart(
        columns,
        agg === 'none' ? rows.slice(0, MAX_POINTS) : rows,
        { x: spec.x, y: spec.y, agg, series: spec.series && spec.series !== spec.x && !(spec.y ?? []).includes(spec.series) ? spec.series : null, sort: spec.sort, limit: TOP[type] ?? 0, fold: type === 'pie' },
        otherLabel,
      );
      const series = shaped.series.slice(0, MAX_SERIES);
      const shownCats = type === 'pie' ? shaped.categories.length - 1 : shaped.categories.length;
      const folded = shaped.total > shownCats && shaped.total > (TOP[type] ?? Infinity)
        ? (type === 'pie' ? note?.(shownCats, shaped.total) : noteTop?.(shownCats, shaped.total)) ?? null
        : null;
      const title = folded
        ? { text: folded, right: 8, top: 0, textStyle: { fontSize: 11, fontWeight: 'normal' as const, color: text } }
        : undefined;
      const yName = spec.y?.length === 1 ? (agg === 'none' ? spec.y[0] : `${agg} of ${spec.y[0]}`) : agg === 'count' && !spec.y?.length ? 'count' : undefined;
      const allValues = series.flatMap((sr) => sr.data);
      // Axis titles sit centred along their axis (y rotated), and the grid reserves room for
      // tick labels *and* titles (ECharts 6 outerBounds), so neither is clipped.
      const valueAxis = {
        type: 'value' as const,
        name: yName,
        nameLocation: 'middle' as const,
        nameGap: nameGapFor(allValues),
        nameTextStyle: { color: text },
        axisLabel: { formatter: tick },
        splitLine: { lineStyle: { opacity: 0.35 } },
      };
      const grid = { left: 12, right: 24, top: 0, bottom: 12, outerBoundsMode: 'same' as const, outerBoundsContain: 'all' as const };
      const axisTooltip = (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as Array<{ axisValueLabel?: string; marker?: string; seriesName?: string; value?: unknown }>;
        const head = `${esc(spec.x)}: <b>${esc(list[0]?.axisValueLabel)}</b>`;
        // Only series with a value here: listing every split value with "–" buried the answer.
        const lines = list.filter((p) => p.value != null && p.value !== '').map((p) => `${p.marker ?? ''}${esc(p.seriesName)}: <b>${esc(full.format(Number(p.value)))}</b>`);
        return [head, ...lines].join('<br/>');
      };
      const legend = series.length > 1 ? { type: 'scroll' as const, top: 0, left: 0, textStyle: { color: text } } : undefined;
      const top = legend || title ? 36 : 24;
      let option: Record<string, unknown>;

      if (type === 'pie') {
        const s = series[0];
        option = {
          color: PALETTE,
          title,
          tooltip: { trigger: 'item', valueFormatter: (v: number) => full.format(v) },
          legend: { type: 'scroll', bottom: 0, textStyle: { color: text } },
          series: [{
            type: 'pie',
            radius: ['38%', '68%'],
            label: { color: text, formatter: '{b}: {d}%' },
            data: shaped.categories.map((name, k) => ({
              name, value: s?.data[k] ?? 0,
              ...(name === otherLabel && k === shaped.categories.length - 1 ? { itemStyle: { color: dark ? '#4b5563' : '#c3c9d0' } } : {}),
            })),
          }],
        };
      } else if (type === 'scatter' && shaped.numericX && agg === 'none') {
        const xi = columns.indexOf(spec.x!);
        option = {
          color: PALETTE,
          title,
          legend,
          // Both coordinates, named, as in any BI scatter — not just the y value.
          tooltip: {
            trigger: 'item',
            formatter: (p: { marker?: string; seriesName?: string; value?: [number, number] }) => [
              `${p.marker ?? ''}${esc(p.seriesName)}`,
              `${esc(spec.x)}: <b>${esc(tick(p.value?.[0] ?? NaN))}</b>`,
              `${esc(spec.y?.[0] ?? p.seriesName)}: <b>${esc(tick(p.value?.[1] ?? NaN))}</b>`,
            ].join('<br/>'),
          },
          grid: { ...grid, top },
          xAxis: { type: 'value', name: spec.x, scale: true, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: text }, axisLabel: { formatter: tick }, splitLine: { lineStyle: { opacity: 0.35 } } },
          yAxis: { ...valueAxis, scale: true },
          series: series.map((sr, k) => ({
            type: 'scatter',
            name: sr.name,
            symbolSize: 6,
            data: rows.slice(0, MAX_POINTS).map((r, j) => [Number(r[xi]), sr.data[j]]).filter((p) => Number.isFinite(p[0]) && p[1] != null),
            itemStyle: { color: PALETTE[k % PALETTE.length] },
          })),
        };
      } else {
        const horizontal = type === 'bar' && Boolean(spec.horizontal);
        const categoryAxis = {
          type: 'category' as const,
          data: shaped.categories,
          name: spec.x,
          nameLocation: 'middle' as const,
          nameGap: horizontal ? 0 : 30,
          nameTextStyle: { color: text },
          axisLabel: { hideOverlap: true, width: horizontal ? 140 : 96, overflow: 'truncate' as const },
        };
        const fewBars = type === 'bar' && shaped.categories.length <= 12 && series.length <= 3 && !spec.stacked;
        option = {
          color: PALETTE,
          title,
          legend,
          tooltip: type === 'scatter'
            ? { trigger: 'item', formatter: (p: { marker?: string; seriesName?: string; name?: string; value?: unknown }) =>
              `${p.marker ?? ''}${esc(p.seriesName)}<br/>${esc(spec.x)}: <b>${esc(p.name)}</b><br/>${esc(spec.y?.[0] ?? p.seriesName)}: <b>${p.value == null ? '–' : esc(full.format(Number(p.value)))}</b>` }
            : { trigger: 'axis', formatter: axisTooltip },
          grid: { ...grid, top },
          xAxis: horizontal ? { ...valueAxis, nameGap: 28 } : categoryAxis,
          // Lines fit the axis to the data (a series around 900K drawn from 0 looks flat); bars
          // keep zero, since their length is the value.
          yAxis: horizontal ? { ...categoryAxis, inverse: true, nameGap: 0, name: undefined } : { ...valueAxis, scale: (type === 'line' || type === 'area') && !spec.stacked },
          series: series.map((sr) => ({
            type: type === 'area' ? 'line' : type,
            name: sr.name,
            stack: spec.stacked && type !== 'scatter' ? 'total' : undefined,
            areaStyle: type === 'area' ? { opacity: spec.stacked ? 0.6 : 0.25 } : undefined,
            smooth: type === 'line' || type === 'area' ? 0.2 : undefined,
            showSymbol: shaped.categories.length < 60,
            symbolSize: type === 'scatter' ? 8 : undefined,
            barMaxWidth: 48,
            label: fewBars ? { show: true, position: horizontal ? 'right' : 'top', color: text, formatter: (p: { value: number }) => tick(p.value) } : undefined,
            data: sr.data,
          })),
        };
      }
      chart.setOption({ backgroundColor: 'transparent', textStyle: { color: text }, ...option });
    });
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      chart?.dispose();
    };
  }, [spec, columns, rows, dark, otherLabel, note, noteTop]);

  return <div ref={ref} className="nb-chart-canvas" role="img" aria-label={ariaLabel} style={{ width: '100%', height: 340 }} />;
}

/** Report colours for a chart image; kept in step with the report's own light and dark palettes. */
export const REPORT_CHART_THEME = {
  light: { ink: '#1b2430', background: '#ffffff' },
  dark: { ink: '#e3e9ee', background: '#141a21' },
} as const;

/** The chart inside ``el`` as a PNG for reports, drawn in the report's light or dark palette
 * whatever theme the app is in (the page shows the one matching the reader's setting). */
export async function chartImage(el: Element | null, theme: 'light' | 'dark' = 'light'): Promise<string | null> {
  if (!el) return null;
  const echarts = await import('echarts');
  const live = echarts.getInstanceByDom(el as HTMLElement);
  if (!live) return null;
  const option = live.getOption() as Record<string, unknown>;
  const { ink, background } = REPORT_CHART_THEME[theme];
  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []) as Array<Record<string, unknown>>;
  const withText = (v: unknown) => list(v).map((x) => ({ ...x, textStyle: { ...((x.textStyle as object) || {}), color: ink } }));
  const axis = (v: unknown) => list(v).map((x) => ({ ...x, nameTextStyle: { ...((x.nameTextStyle as object) || {}), color: ink } }));
  const series = list(option.series).map((x) => (x.label ? { ...x, label: { ...(x.label as object), color: ink } } : x));
  const holder = document.createElement('div');
  Object.assign(holder.style, { position: 'fixed', left: '-10000px', top: '0', width: '880px', height: '360px' });
  document.body.appendChild(holder);
  try {
    const chart = echarts.init(holder, theme === 'dark' ? 'dark' : undefined, { renderer: 'canvas' });
    chart.setOption({
      ...option, animation: false, backgroundColor: background, textStyle: { color: ink },
      legend: withText(option.legend), title: withText(option.title), xAxis: axis(option.xAxis), yAxis: axis(option.yAxis), series,
    });
    const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: background });
    chart.dispose();
    return url;
  } finally {
    holder.remove();
  }
}
