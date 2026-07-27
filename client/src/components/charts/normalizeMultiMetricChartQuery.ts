/**
 * Promote chat / ECharts chart metadata into the dashboard ChartQuery shape
 * (multi-measure `yMetrics[]`), matching Query Editor visualize / industry Bind.
 *
 * Chat historically stored a singular `yMetric` (often a column name) while plotting
 * extra series in ECharts only — properties then showed one Y and live refresh dropped peers.
 */

import type { ChartQuery } from '@/app/(dashboard)/dashboards/services/chartService';

const AGG_MODES = new Set([
  'count',
  'sum',
  'none',
  'distinct_count',
  'avg',
  'min',
  'max',
  'mean',
]);

const MAX_METRICS = 5;

function isAggMode(value: unknown): boolean {
  return typeof value === 'string' && AGG_MODES.has(value.trim().toLowerCase());
}

function isNumericCell(val: unknown): boolean {
  if (typeof val === 'number' && Number.isFinite(val)) return true;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return true;
  return false;
}

function caseMatch(columns: string[], name: string): string | undefined {
  const exact = columns.find((c) => c === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return columns.find((c) => c.toLowerCase() === lower);
}

function uniqueFields(fields: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    const key = f.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

function metricFromField(field: string, aggregation = 'none'): { field: string; aggregation: string } {
  return { field, aggregation };
}

export type PromoteChartQueryOptions = {
  queryResult?: Record<string, unknown>[] | null;
  /** Column names inferred from ECharts series encode / names */
  measureHints?: string[];
};

/**
 * Normalize any chat/meta/query blob into a ChartQuery with `yMetrics` populated
 * whenever multiple measures are available.
 */
export function promoteChartQueryToMultiMetrics(
  source: Record<string, unknown> | null | undefined,
  opts: PromoteChartQueryOptions = {},
): ChartQuery {
  const raw = { ...(source || {}) } as Record<string, unknown>;
  const rows = opts.queryResult?.length ? opts.queryResult : null;
  const columns = rows ? Object.keys(rows[0] || {}) : [];

  let x = String(raw.x || raw.xField || raw.xAxis || raw.x_axis || '').trim() || undefined;
  if (x && columns.length) {
    x = caseMatch(columns, x) || x;
  }

  let groupField =
    String(raw.groupField || raw.group || raw.groupBy || raw.legend || '').trim() || undefined;
  if (groupField && columns.length) {
    groupField = caseMatch(columns, groupField) || groupField;
  }
  if (groupField && x && groupField.toLowerCase() === x.toLowerCase()) {
    groupField = undefined;
  }

  // Infer category X from first non-numeric column when meta omitted it (common AI SQL).
  if (!x && rows && columns.length) {
    const nonNumeric = columns.find((col) => {
      if (groupField && col.toLowerCase() === groupField.toLowerCase()) return false;
      const vals = rows.map((r) => r[col]).filter((v) => v != null && v !== '');
      if (!vals.length) return true;
      return !vals.every((v) => isNumericCell(v));
    });
    x = nonNumeric || columns[0];
  }

  const existingMetrics = Array.isArray(raw.yMetrics)
    ? (raw.yMetrics as Array<{ field?: string; aggregation?: string; label?: string }>)
        .map((m) => {
          const field = String(m?.field || '').trim();
          if (!field) return null;
          const resolved = columns.length ? caseMatch(columns, field) || field : field;
          return {
            field: resolved,
            aggregation: String(m?.aggregation || 'none').toLowerCase() || 'none',
            ...(m?.label ? { label: String(m.label) } : {}),
          };
        })
        .filter(Boolean) as Array<{ field: string; aggregation: string; label?: string }>
    : [];

  const measureHints: string[] = [];

  const pushHint = (name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) return;
    if (isAggMode(name)) return;
    measureHints.push(name.trim());
  };

  if (Array.isArray(raw.yFields)) {
    for (const f of raw.yFields) pushHint(f);
  }
  if (Array.isArray(raw.extra_series)) {
    for (const f of raw.extra_series) pushHint(f);
  }
  if (Array.isArray(raw.extraSeries)) {
    for (const f of raw.extraSeries) pushHint(f);
  }
  for (const h of opts.measureHints || []) pushHint(h);

  const singularY = raw.yMetric ?? raw.yField ?? raw.metric ?? raw.y_axis;
  if (typeof singularY === 'string' && singularY.trim() && !isAggMode(singularY)) {
    pushHint(singularY);
  }

  let yMetrics = existingMetrics;

  // Expand a single-measure query when result/hints clearly have more numerics
  // (common for older chat pins that only stored singular yMetric).
  if (yMetrics.length === 1 && (rows?.length || measureHints.length > 1)) {
    const seed = yMetrics[0].field;
    const extra: string[] = [];
    for (const h of measureHints) {
      const resolved = columns.length ? caseMatch(columns, h) || h : h;
      if (resolved && resolved.toLowerCase() !== seed.toLowerCase()) extra.push(resolved);
    }
    if (rows && columns.length) {
      for (const col of columns) {
        if (x && col.toLowerCase() === x.toLowerCase()) continue;
        if (groupField && col.toLowerCase() === groupField.toLowerCase()) continue;
        if (col.toLowerCase() === seed.toLowerCase()) continue;
        if (rows.some((r) => isNumericCell(r[col]))) extra.push(col);
      }
    }
    const expanded = uniqueFields([seed, ...extra]);
    if (expanded.length > 1) {
      yMetrics = expanded.slice(0, MAX_METRICS).map((field) =>
        metricFromField(field, yMetrics[0]?.aggregation || 'none'),
      );
    }
  }

  if (!yMetrics.length) {
    const resolvedHints = uniqueFields(measureHints)
      .map((h) => (columns.length ? caseMatch(columns, h) || h : h))
      .filter((h) => !x || h.toLowerCase() !== x.toLowerCase())
      .filter((h) => !groupField || h.toLowerCase() !== groupField.toLowerCase());

    let fields = resolvedHints;
    if (rows && columns.length) {
      const numericCols = columns.filter((col) => {
        if (x && col.toLowerCase() === x.toLowerCase()) return false;
        if (groupField && col.toLowerCase() === groupField.toLowerCase()) return false;
        return rows.some((r) => isNumericCell(r[col]));
      });
      // Prefer hint order, then any remaining numeric columns from the result set
      fields = uniqueFields([...resolvedHints, ...numericCols]);
    }

    if (fields.length) {
      yMetrics = fields.slice(0, MAX_METRICS).map((field) => metricFromField(field, 'none'));
    }
  }

  // Infer second categorical as Legend when only one measure (long-form break-by).
  if (!groupField && rows && columns.length && yMetrics.length === 1) {
    const measureSet = new Set(yMetrics.map((m) => m.field.toLowerCase()));
    const dims = columns.filter((col) => {
      if (x && col.toLowerCase() === x.toLowerCase()) return false;
      if (measureSet.has(col.toLowerCase())) return false;
      return !rows.every((r) => r[col] == null || isNumericCell(r[col]));
    });
    if (dims.length >= 1) {
      groupField = dims[0];
    }
  }

  // Power BI / Tableau XOR: multi-measure vs legend break-by.
  // Prefer multi-measure when several value columns / hints exist.
  if (groupField && yMetrics.length > 1) {
    const preferMulti =
      measureHints.length > 1 ||
      existingMetrics.length > 1 ||
      (rows != null &&
        columns.filter((col) => {
          if (x && col.toLowerCase() === x.toLowerCase()) return false;
          if (groupField && col.toLowerCase() === groupField.toLowerCase()) return false;
          return rows.some((r) => isNumericCell(r[col]));
        }).length > 1);
    if (preferMulti) {
      groupField = undefined;
    } else {
      yMetrics = yMetrics.slice(0, 1);
    }
  }

  // Aggregation mode: when measures are explicit columns from SQL/chat, use none.
  let yMetricAgg: ChartQuery['yMetric'] = 'none';
  if (typeof singularY === 'string' && isAggMode(singularY)) {
    yMetricAgg = singularY.trim().toLowerCase() as ChartQuery['yMetric'];
  } else if (typeof raw.yMetric === 'string' && isAggMode(raw.yMetric)) {
    yMetricAgg = raw.yMetric.trim().toLowerCase() as ChartQuery['yMetric'];
  } else if (yMetrics.length && yMetrics.every((m) => m.aggregation && m.aggregation !== 'none')) {
    yMetricAgg = (yMetrics[0].aggregation as ChartQuery['yMetric']) || 'none';
  }

  // Chat/SQL result paths: avoid double-aggregation on live refresh (sum over pre-agg SQL).
  if (rows || (opts.measureHints && opts.measureHints.length > 0)) {
    yMetrics = yMetrics.map((m) => ({
      ...m,
      aggregation: !m.aggregation || m.aggregation === 'sum' ? 'none' : m.aggregation,
    }));
    if (yMetrics.length) yMetricAgg = 'none';
  }

  const sortBy = (raw.sortBy as string) || (x ? 'x' : 'record_order');
  const sortOrder = (raw.sortOrder as 'asc' | 'desc') || 'asc';

  const next: ChartQuery = {
    ...(raw as ChartQuery),
    x,
    yMetrics,
    yMetric: yMetricAgg,
    sortBy,
    sortOrder,
    filters: (raw.filters as ChartQuery['filters']) || [],
    metricFilters: (raw.metricFilters as ChartQuery['metricFilters']) || [],
  };

  if (groupField && yMetrics.length <= 1) {
    next.groupField = groupField;
    (next as Record<string, unknown>).legend = groupField;
    (next as Record<string, unknown>).group = groupField;
  } else {
    delete next.groupField;
    delete (next as Record<string, unknown>).legend;
    delete (next as Record<string, unknown>).group;
  }

  // Extra categorical columns → drill hierarchy (only when hierarchy is clear)
  if (rows && columns.length) {
    const used = new Set(
      [next.x, next.groupField, ...(next.yMetrics || []).map((m) => m.field)]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase()),
    );
    const existingDrill = Array.isArray(raw.drillPath)
      ? (raw.drillPath as unknown[]).map((d) => String(d || '').trim()).filter(Boolean)
      : [];
    const categorical = columns.filter((col) => {
      if (used.has(col.toLowerCase())) return false;
      const vals = rows.map((r) => r[col]).filter((v) => v != null && v !== '');
      if (!vals.length) return false;
      return !vals.every((v) => isNumericCell(v));
    });
    let drillPath = existingDrill.filter((d) => !used.has(d.toLowerCase()));
    // Auto-fill remaining dims only when a multi-level hierarchy is obvious (3+ cats total)
    const totalCats =
      (next.x ? 1 : 0) + (next.groupField ? 1 : 0) + categorical.length;
    if (!drillPath.length && totalCats >= 3 && (next.yMetrics?.length || 0) <= 1) {
      drillPath = categorical.slice(0, 4);
    } else if (drillPath.length && categorical.length) {
      drillPath = uniqueFields([...drillPath, ...categorical]).slice(0, 6);
    }
    if (drillPath.length) {
      next.drillPath = drillPath;
    }
  }

  // Preserve explicit xGrain from meta when present
  if (typeof raw.xGrain === 'string' && raw.xGrain.trim()) {
    next.xGrain = raw.xGrain.trim();
  } else if (
    next.x &&
    rows &&
    /date|time|month|year|week|day|quarter/i.test(next.x) &&
    !next.xGrain
  ) {
    // Soft default for date-like X from AI SQL
    if (/year/i.test(next.x)) next.xGrain = 'year';
    else if (/quarter/i.test(next.x)) next.xGrain = 'quarter';
    else if (/month/i.test(next.x)) next.xGrain = 'month';
    else if (/week/i.test(next.x)) next.xGrain = 'week';
    else if (/hour/i.test(next.x)) next.xGrain = 'hour';
    else if (/day|date/i.test(next.x)) next.xGrain = 'day';
  }

  // Drop singular field-as-yMetric pollution from chat meta
  if (typeof singularY === 'string' && !isAggMode(singularY)) {
    // already folded into yMetrics
  }

  return next;
}

/** Infer measure column hints from an ECharts option (multi-series bar/line). */
export function measureHintsFromEchartsConfig(cfg: Record<string, unknown> | null | undefined): string[] {
  if (!cfg) return [];
  const hints: string[] = [];
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const ds = cfg.dataset as Record<string, unknown> | undefined;
  const dimensions = (ds?.dimensions as string[] | undefined) || [];

  for (const s of series) {
    const encode = s.encode as Record<string, unknown> | undefined;
    const yEnc = encode?.y;
    if (typeof yEnc === 'string' && yEnc.trim()) {
      hints.push(yEnc.trim());
    } else if (Array.isArray(yEnc) && yEnc.length) {
      const first = yEnc[0];
      if (typeof first === 'string') hints.push(first);
      else if (typeof first === 'number' && dimensions[first]) hints.push(dimensions[first]);
    }
    const name = s.name;
    if (typeof name === 'string' && name.trim() && !/^series\s*\d*$/i.test(name)) {
      hints.push(name.trim());
    }
  }

  const meta = cfg._chart_query as Record<string, unknown> | undefined;
  if (meta) {
    if (typeof meta.yMetric === 'string') hints.push(meta.yMetric);
    if (Array.isArray(meta.extra_series)) {
      for (const e of meta.extra_series) {
        if (typeof e === 'string') hints.push(e);
      }
    }
    if (Array.isArray(meta.yMetrics)) {
      for (const m of meta.yMetrics as Array<{ field?: string }>) {
        if (m?.field) hints.push(String(m.field));
      }
    }
  }

  return uniqueFields(hints);
}

/** Detect horizontal bar orientation from ECharts option. */
export function extractBarOrientationOptions(
  cfg: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!cfg) return {};
  const xAxis = Array.isArray(cfg.xAxis)
    ? (cfg.xAxis[0] as Record<string, unknown>)
    : (cfg.xAxis as Record<string, unknown> | undefined);
  const yAxis = Array.isArray(cfg.yAxis)
    ? (cfg.yAxis[0] as Record<string, unknown>)
    : (cfg.yAxis as Record<string, unknown> | undefined);

  const xIsValue = xAxis?.type === 'value';
  const yIsCategory =
    yAxis?.type === 'category' || (Array.isArray(yAxis?.data) && (yAxis!.data as unknown[]).length > 0);
  const xHasNoCats = !Array.isArray(xAxis?.data) || (xAxis!.data as unknown[]).length === 0;

  if (xIsValue && yIsCategory && xHasNoCats) {
    return { barChartType: 'horizontal' };
  }
  return {};
}

/** Categories for horizontal bars live on yAxis.data in ECharts. */
export function categoriesFromEchartsConfig(cfg: Record<string, unknown> | null | undefined): string[] {
  if (!cfg) return [];
  const xAxis = Array.isArray(cfg.xAxis)
    ? (cfg.xAxis[0] as Record<string, unknown>)
    : (cfg.xAxis as Record<string, unknown> | undefined);
  const yAxis = Array.isArray(cfg.yAxis)
    ? (cfg.yAxis[0] as Record<string, unknown>)
    : (cfg.yAxis as Record<string, unknown> | undefined);

  const xData = (xAxis?.data as unknown[]) || [];
  const yData = (yAxis?.data as unknown[]) || [];

  if (xAxis?.type === 'value' && yData.length) {
    return yData.map((v) => String(v ?? ''));
  }
  if (xData.length) {
    return xData.map((v) => String(v ?? ''));
  }
  return [];
}

/**
 * ECharts places category index 0 at the *bottom* of horizontal bars.
 * Reverse so SQL/ORDER BY (e.g. DESC) shows the first row at the top — industry default.
 */
export function orientDataForHorizontalBar<T extends { x?: unknown[]; y?: unknown[]; series?: Array<{ data?: unknown[] }>; secondarySeries?: Array<{ data?: unknown[] }> }>(
  data: T,
): T {
  if (!data?.x?.length) return data;
  const reverseArr = <V,>(arr: V[] | undefined): V[] | undefined =>
    Array.isArray(arr) ? [...arr].reverse() : arr;

  return {
    ...data,
    x: reverseArr(data.x as unknown[]) as T['x'],
    y: reverseArr(data.y as unknown[]) as T['y'],
    series: data.series?.map((s) => ({ ...s, data: reverseArr(s.data as unknown[]) })),
    secondarySeries: data.secondarySeries?.map((s) => ({
      ...s,
      data: reverseArr(s.data as unknown[]),
    })),
  };
}
