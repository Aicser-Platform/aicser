/**
 * Chart design layer — declarative presentation on top of chartQuery + ECharts.
 *
 * Industry alignment (Tableau Marks/Format, Power BI format pane, Looker vis config):
 * data mapping stays in chartQuery; look & annotations live in chartOptions.design.
 *
 * compileDesignToEcharts patches a complete option (axes, markArea, markLine,
 * graphic callouts, ranked labels) without rewriting series data builders.
 */

export type ChartDesignTemplate = 'standard' | 'ranked_bar' | 'efficiency_scatter';

export type ChartAxisScale = 'linear' | 'log';

export type ChartDesignMarkArea = {
  /** Inclusive value-axis bounds (scatter / numeric). Category bands use xCategory*. */
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  xCategory0?: string;
  xCategory1?: string;
  fill?: string;
  label?: string;
};

export type ChartDesignMarkLine = {
  /** Horizontal threshold (yAxis) or vertical (xAxis). */
  axis: 'x' | 'y';
  value: number;
  label?: string;
  color?: string;
};

export type ChartDesignCallout = {
  /** Category name (bar) or point label (scatter). */
  target: string;
  text: string;
  color?: string;
};

export type ChartDesignCategoryStyle = {
  color?: string;
  /** Optional icon URL for rich axis labels (Tier C; best-effort). */
  iconUrl?: string;
};

export type ChartDesign = {
  template?: ChartDesignTemplate;
  axis?: {
    xScale?: ChartAxisScale;
    yScale?: ChartAxisScale;
  };
  labels?: {
    /** Show numeric value on bars (ranked style). */
    valueOnBar?: boolean;
    /** Prefer inside / top for bar labels. */
    valuePosition?: 'top' | 'inside' | 'insideTop';
  };
  marks?: {
    areas?: ChartDesignMarkArea[];
    lines?: ChartDesignMarkLine[];
    /** Derive Pareto / efficiency frontier on scatter (first series). */
    pareto?: boolean;
    callouts?: ChartDesignCallout[];
  };
  brand?: {
    logoUrl?: string;
    footer?: string;
    categoryStyles?: Record<string, ChartDesignCategoryStyle>;
  };
};

export const CHART_DESIGN_TEMPLATES: Array<{
  id: ChartDesignTemplate;
  labelKey: string;
  descKey: string;
  /** Chart types this template is meant for. */
  chartTypes: string[];
}> = [
  {
    id: 'standard',
    labelKey: 'design_template_standard',
    descKey: 'design_template_standard_desc',
    chartTypes: ['bar', 'line', 'area', 'scatter'],
  },
  {
    id: 'ranked_bar',
    labelKey: 'design_template_ranked_bar',
    descKey: 'design_template_ranked_bar_desc',
    chartTypes: ['bar'],
  },
  {
    id: 'efficiency_scatter',
    labelKey: 'design_template_efficiency_scatter',
    descKey: 'design_template_efficiency_scatter_desc',
    chartTypes: ['scatter'],
  },
];

/** Apply a curated template → design + companion chartOptions patches. */
export function applyChartDesignTemplate(
  template: ChartDesignTemplate,
): { design: ChartDesign; chartOptionPatches: Record<string, unknown> } {
  if (template === 'ranked_bar') {
    return {
      design: {
        template: 'ranked_bar',
        labels: { valueOnBar: true, valuePosition: 'inside' },
        axis: { xScale: 'linear', yScale: 'linear' },
      },
      chartOptionPatches: {
        barChartType: 'horizontal',
        showDataLabel: true,
        showLegend: false,
        showGridline: true,
      },
    };
  }
  if (template === 'efficiency_scatter') {
    return {
      design: {
        template: 'efficiency_scatter',
        axis: { xScale: 'log', yScale: 'linear' },
        marks: {
          pareto: true,
          areas: [
            {
              // "Most attractive" upper-leftish band — relative; compiler
              // remaps from data extents when x0/y0 omitted partially.
              x0: undefined,
              x1: undefined,
              y0: undefined,
              y1: undefined,
              fill: 'rgba(34, 197, 94, 0.12)',
              label: 'High performance / lean size',
            },
          ],
        },
      },
      chartOptionPatches: {
        showDataLabel: false,
        showLegend: true,
        legendPosition: 'top',
        showGridline: true,
      },
    };
  }
  return {
    design: { template: 'standard' },
    chartOptionPatches: {},
  };
}

function cloneOption<T>(option: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(option);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(option)) as T;
}

function asAxisArray(axis: unknown): any[] {
  if (axis == null) return [];
  return Array.isArray(axis) ? axis : [axis];
}

function patchAxisScale(axis: any, scale: ChartAxisScale | undefined): any {
  if (!axis || !scale || scale === 'linear') {
    if (axis && scale === 'linear' && axis.type === 'log') {
      const next = { ...axis };
      delete next.type;
      // Restore value axis if it was log
      if (!next.type) next.type = 'value';
      return next;
    }
    return axis;
  }
  if (scale === 'log') {
    // Only numeric axes support log
    if (axis.type === 'category') return axis;
    return {
      ...axis,
      type: 'log',
      logBase: 10,
      min: axis.min != null ? axis.min : 'dataMin',
    };
  }
  return axis;
}

function isForecastLikeSeries(series: any[]): boolean {
  const names = series.map((s) => String(s?.name || '').toLowerCase());
  const hasHist = names.some((n) => n.includes('historical'));
  const hasFc = names.some((n) => n === 'forecast' || n.includes('forecast'));
  const hasBand = series.some(
    (s) =>
      s?.stack === 'confidence-band' ||
      s?.stack === 'ci' ||
      String(s?.name || '')
        .toLowerCase()
        .includes('confidence'),
  );
  return (hasHist && hasFc) || hasBand;
}

function collectScatterPoints(series: any[]): Array<{ x: number; y: number; name?: string }> {
  const out: Array<{ x: number; y: number; name?: string }> = [];
  for (const s of series) {
    if (!s || s.type === 'line' && s.markLine) continue;
    const data = Array.isArray(s.data) ? s.data : [];
    for (const pt of data) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          out.push({ x, y, name: typeof pt[2] === 'string' ? pt[2] : s.name });
        }
      } else if (pt && typeof pt === 'object' && 'value' in pt) {
        const v = (pt as { value?: unknown }).value;
        if (Array.isArray(v) && v.length >= 2) {
          const x = Number(v[0]);
          const y = Number(v[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            out.push({
              x,
              y,
              name: String((pt as { name?: string }).name || s.name || ''),
            });
          }
        }
      }
    }
  }
  return out;
}

/** Pareto frontier: non-dominated points maximizing y for a given x (or less x). */
export function computeParetoFrontier(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y);
  const frontier: Array<{ x: number; y: number }> = [];
  let maxY = -Infinity;
  for (const p of sorted) {
    if (p.y >= maxY) {
      frontier.push(p);
      maxY = p.y;
    }
  }
  return frontier;
}

function buildMarkAreaData(areas: ChartDesignMarkArea[]): any[] {
  return areas.map((a) => {
    const itemStyle = {
      color: a.fill || 'rgba(34, 197, 94, 0.12)',
    };
    const label = a.label
      ? { show: true, formatter: a.label, position: 'insideTopLeft', color: '#64748b', fontSize: 11 }
      : { show: false };

    if (a.xCategory0 != null || a.xCategory1 != null) {
      return [
        { xAxis: a.xCategory0 ?? a.xCategory1, itemStyle, label },
        { xAxis: a.xCategory1 ?? a.xCategory0 },
      ];
    }
    const p0: Record<string, number> = {};
    const p1: Record<string, number> = {};
    if (a.x0 != null) p0.xAxis = a.x0;
    if (a.y0 != null) p0.yAxis = a.y0;
    if (a.x1 != null) p1.xAxis = a.x1;
    if (a.y1 != null) p1.yAxis = a.y1;
    // If only y band
    if (a.y0 != null && a.y1 != null && a.x0 == null && a.x1 == null) {
      return [
        { yAxis: a.y0, itemStyle, label },
        { yAxis: a.y1 },
      ];
    }
    if (a.x0 != null && a.x1 != null && a.y0 == null && a.y1 == null) {
      return [
        { xAxis: a.x0, itemStyle, label },
        { xAxis: a.x1 },
      ];
    }
    return [
      { ...p0, itemStyle, label },
      { ...p1 },
    ];
  });
}

function designMarkLines(lines: ChartDesignMarkLine[]): any[] {
  return lines
    .filter((l) => Number.isFinite(l.value))
    .map((l) => ({
      name: l.label || undefined,
      [l.axis === 'x' ? 'xAxis' : 'yAxis']: l.value,
      label: {
        show: !!l.label,
        formatter: l.label || '',
        position: 'insideEndTop',
      },
      lineStyle: {
        color: l.color || '#a855f7',
        type: 'dashed',
        width: 1.5,
      },
    }));
}

/**
 * Compile declarative design into an ECharts option.
 * Pure: does not mutate the input. Preserves forecast CI / waterfall stacks.
 */
export function compileDesignToEcharts(
  option: Record<string, unknown> | null | undefined,
  design: ChartDesign | null | undefined,
  ctx?: { chartType?: string },
): Record<string, unknown> {
  if (!option || typeof option !== 'object') return (option ?? {}) as Record<string, unknown>;
  if (!design || typeof design !== 'object') return option;

  const next = cloneOption(option) as Record<string, any>;
  const chartType = (ctx?.chartType || '').toLowerCase();
  const series: any[] = Array.isArray(next.series) ? next.series : [];

  // Never flatten forecast / CI stacks
  const preserveSeries = isForecastLikeSeries(series) || series.some((s) => s?.stack === 'waterfall');

  // ── Axis scales ──────────────────────────────────────────────────────────
  if (design.axis?.xScale || design.axis?.yScale) {
    const xAxes = asAxisArray(next.xAxis).map((ax) => patchAxisScale(ax, design.axis?.xScale));
    const yAxes = asAxisArray(next.yAxis).map((ax) => patchAxisScale(ax, design.axis?.yScale));
    if (xAxes.length) next.xAxis = Array.isArray(next.xAxis) ? xAxes : xAxes[0];
    if (yAxes.length) next.yAxis = Array.isArray(next.yAxis) ? yAxes : yAxes[0];
  }

  // ── Ranked bar labels ────────────────────────────────────────────────────
  if (design.labels?.valueOnBar && !preserveSeries) {
    const pos = design.labels.valuePosition || 'inside';
    next.series = series.map((s) => {
      if (!s || (s.type && s.type !== 'bar')) return s;
      return {
        ...s,
        label: {
          ...(typeof s.label === 'object' && s.label ? s.label : {}),
          show: true,
          position: pos,
          color: pos === 'inside' || pos === 'insideTop' ? '#fff' : undefined,
          fontWeight: 600,
          fontSize: 11,
        },
      };
    });
  }

  // ── Category brand colors (single-series categorical bars) ───────────────
  const catStyles = design.brand?.categoryStyles;
  if (catStyles && Object.keys(catStyles).length && !preserveSeries) {
    const xAxis0 = asAxisArray(next.xAxis)[0];
    const yAxis0 = asAxisArray(next.yAxis)[0];
    const cats: string[] =
      (xAxis0?.type === 'category' && Array.isArray(xAxis0.data) ? xAxis0.data : null) ||
      (yAxis0?.type === 'category' && Array.isArray(yAxis0.data) ? yAxis0.data : null) ||
      [];
    if (cats.length) {
      next.series = (Array.isArray(next.series) ? next.series : series).map((s) => {
        if (!s || s.type !== 'bar' || !Array.isArray(s.data)) return s;
        // Only recolor when one series (category coloring)
        const primaryCount = (Array.isArray(next.series) ? next.series : []).filter(
          (x) => x && x.type === 'bar',
        ).length;
        if (primaryCount > 1) return s;
        return {
          ...s,
          data: s.data.map((v: unknown, i: number) => {
            const cat = String(cats[i] ?? '');
            const style = catStyles[cat];
            const num = typeof v === 'object' && v && 'value' in (v as object)
              ? (v as { value: number }).value
              : v;
            if (!style?.color) return v;
            return {
              value: num,
              itemStyle: { color: style.color },
            };
          }),
        };
      });
    }
  }

  // ── Mark areas ───────────────────────────────────────────────────────────
  let areas = [...(design.marks?.areas || [])];
  if (design.template === 'efficiency_scatter' && chartType === 'scatter') {
    const pts = collectScatterPoints(series);
    if (pts.length >= 2) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const midX = Math.exp((Math.log(Math.max(minX, 1e-9)) + Math.log(Math.max(maxX, 1e-9))) / 2);
      const midY = (minY + maxY) / 2;
      // Attractive quadrant: lower-left of size (lean) × upper half of score
      if (!areas.length || (areas.length === 1 && areas[0].x0 == null && areas[0].y0 == null)) {
        areas = [
          {
            x0: minX,
            x1: midX,
            y0: midY,
            y1: maxY,
            fill: 'rgba(34, 197, 94, 0.12)',
            label: areas[0]?.label || 'Most attractive',
          },
        ];
      }
    }
  }

  if (areas.length && series[0] && !preserveSeries) {
    const markArea = {
      silent: true,
      data: buildMarkAreaData(areas),
      z: 0,
    };
    next.series = (Array.isArray(next.series) ? next.series : series).map((s, i) =>
      i === 0 ? { ...s, markArea: { ...(s.markArea || {}), ...markArea, data: markArea.data } } : s,
    );
  }

  // ── Design mark lines (thresholds) ───────────────────────────────────────
  if (design.marks?.lines?.length && series[0] && !preserveSeries) {
    const extra = designMarkLines(design.marks.lines);
    next.series = (Array.isArray(next.series) ? next.series : series).map((s, i) => {
      if (i !== 0) return s;
      const existing = s.markLine?.data;
      const data = [...(Array.isArray(existing) ? existing : []), ...extra];
      return {
        ...s,
        markLine: {
          symbol: 'none',
          ...(s.markLine || {}),
          data,
        },
      };
    });
  }

  // ── Pareto frontier overlay (scatter) ────────────────────────────────────
  if (design.marks?.pareto && !preserveSeries) {
    const pts = collectScatterPoints(Array.isArray(next.series) ? next.series : series);
    const frontier = computeParetoFrontier(pts);
    if (frontier.length >= 2) {
      const paretoSeries = {
        id: 'aiser-design-pareto',
        name: 'Efficiency frontier',
        type: 'line',
        data: frontier.map((p) => [p.x, p.y]),
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { type: 'dashed', width: 1.5, color: '#0f172a' },
        itemStyle: { color: '#0f172a' },
        z: 5,
        tooltip: { show: true },
      };
      const base = Array.isArray(next.series) ? next.series : series;
      next.series = [...base.filter((s) => s?.id !== 'aiser-design-pareto'), paretoSeries];
      if (next.legend && typeof next.legend === 'object') {
        next.legend = { ...next.legend, show: true };
      }
    }
  }

  // ── Callout graphics ─────────────────────────────────────────────────────
  if (design.marks?.callouts?.length && !preserveSeries) {
    const graphics: any[] = [];
    const existing = next.graphic;
    if (Array.isArray(existing)) graphics.push(...existing);
    else if (existing && typeof existing === 'object') graphics.push(existing);

    design.marks.callouts.forEach((c, idx) => {
      if (!c?.text || !c?.target) return;
      graphics.push({
        id: `aiser-design-callout-${idx}`,
        type: 'group',
        left: '68%',
        top: `${12 + idx * 10}%`,
        children: [
          {
            type: 'text',
            style: {
              text: c.text,
              fill: c.color || '#7c3aed',
              fontSize: 11,
              fontWeight: 600,
              width: 160,
              overflow: 'break',
            },
          },
        ],
      });
    });
    next.graphic = graphics;
  }

  // ── Brand footer (subtle) ────────────────────────────────────────────────
  if (design.brand?.footer) {
    const graphics: any[] = [];
    const existing = next.graphic;
    if (Array.isArray(existing)) graphics.push(...existing.filter((g) => g?.id !== 'aiser-design-footer'));
    else if (existing && typeof existing === 'object' && (existing as any).id !== 'aiser-design-footer') {
      graphics.push(existing);
    }
    graphics.push({
      id: 'aiser-design-footer',
      type: 'text',
      right: 12,
      bottom: 6,
      style: {
        text: design.brand.footer,
        fill: '#94a3b8',
        fontSize: 10,
      },
      z: 100,
    });
    next.graphic = graphics;
  }

  return next;
}

/** Normalize design from chartOptions (tolerant of partial/legacy shapes). */
export function normalizeChartDesign(raw: unknown): ChartDesign | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as ChartDesign;
}
