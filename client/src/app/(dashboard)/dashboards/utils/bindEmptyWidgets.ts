import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import { isNonDataWidget } from '../stores/dashboardStoreTypes';

/**
 * "Use this data for the empty widgets" (QA F-DASH-03). A story layout drops in several unbound
 * widgets; binding them one by one in Properties is where non-technical authors gave up. Once one
 * widget has a table, the rest can follow it — each with fields that suit its type, and KPIs
 * spread across different measures so four cards don't repeat one number.
 */

export type ColumnInfo = { name: string; type: string };

export type WidgetBinding = {
  id: string;
  dataSourceId: string;
  chartQuery: Record<string, unknown>;
  title?: string;
};

const NUMERIC = /(int|float|double|decimal|numeric|number|real|money)/i;
const TEMPORAL = /(date|time|timestamp)/i;

const isKeyLike = (name: string) => {
  const n = name.toLowerCase();
  return n === 'id' || n.endsWith('_id') || n.endsWith('_key');
};
const isTemporal = (c: ColumnInfo) =>
  TEMPORAL.test(c.type) || /date|(^|_)(month|week|day|time|at)$/i.test(c.name);
const isMeasure = (c: ColumnInfo) =>
  NUMERIC.test(c.type) && !isKeyLike(c.name) && !isTemporal(c) && !/(^|_)(year|quarter|month|week|day)$/i.test(c.name);
const isCategory = (c: ColumnInfo) => !NUMERIC.test(c.type) && !isTemporal(c) && !isKeyLike(c.name) && !/^bool/i.test(c.type);

type MetricRef = { field?: string; aggregation?: string };
const metricSig = (m: MetricRef) => `${m.aggregation ?? ''}:${m.field ?? ''}`.toLowerCase();

/**
 * KPI candidates, most useful first, from the table's own shape (works for any data): each
 * measure's total, the number of rows, how many distinct linked things (stores, customers…),
 * then the main measure's average, then how many distinct values each category has (account
 * types, regions: the useful numbers on a lookup table with no measures). Metrics already on
 * the dashboard (`taken`) go last.
 */
export function kpiCandidates(columns: ColumnInfo[], taken: MetricRef[] = []): Array<{ field: string; aggregation: string }> {
  const measures = columns.filter(isMeasure);
  const ownKey = columns.find((c) => isKeyLike(c.name));
  const linkedKeys = columns.filter((c) => isKeyLike(c.name) && c !== ownKey);
  const all: Array<{ field: string; aggregation: string }> = [
    ...measures.map((m) => ({ field: m.name, aggregation: 'sum' })),
    { field: (ownKey ?? columns[0])?.name ?? '*', aggregation: 'count' },
    ...linkedKeys.map((k) => ({ field: k.name, aggregation: 'distinct_count' })),
    ...(measures[0] ? [{ field: measures[0].name, aggregation: 'avg' }] : []),
    ...columns.filter(isCategory).map((c) => ({ field: c.name, aggregation: 'distinct_count' })),
  ];
  const takenSigs = new Set(taken.map(metricSig));
  return [...all.filter((m) => !takenSigs.has(metricSig(m))), ...all.filter((m) => takenSigs.has(metricSig(m)))];
}

const isKpiType = (type?: string) => type === 'stat' || type === 'gauge';

/** Same source, table and metric: two KPI cards with one signature show the same number. */
export function kpiSignature(w: WidgetInstance): string | null {
  if (!isKpiType(w.chartType) || !w.dataSourceId) return null;
  const q = (w.chartQuery || {}) as Record<string, unknown>;
  if (q.saved_query_id || q.query_snapshot_id || !q.tableName) return null;
  const metrics = Array.isArray(q.yMetrics) ? (q.yMetrics as MetricRef[]) : [];
  if (metrics.length === 0) return null;
  return `${w.dataSourceId}|${String(q.tableName)}|${metrics.map(metricSig).join(',')}`;
}

/** KPI cards that repeat an earlier card's number (same source, table and metric), in layout order. */
export function duplicateKpis(widgets: WidgetInstance[]): WidgetInstance[] {
  const seen = new Set<string>();
  const dupes: WidgetInstance[] = [];
  for (const w of widgets) {
    const key = kpiSignature(w);
    if (!key) continue;
    if (seen.has(key)) dupes.push(w);
    else seen.add(key);
  }
  return dupes;
}

/**
 * New metrics for repeated KPI cards on one table: each gets the next candidate nobody on the
 * dashboard shows yet. Cards stay where they are; only what they count changes.
 */
export function planKpiVariety(
  dupes: WidgetInstance[],
  columns: ColumnInfo[],
  taken: MetricRef[],
): Array<{ id: string; chartQuery: Record<string, unknown> }> {
  const used = new Set(taken.map(metricSig));
  const fresh = kpiCandidates(columns, taken).filter((m) => !used.has(metricSig(m)));
  return dupes.slice(0, fresh.length).map((w, i) => ({
    id: w.id,
    chartQuery: { ...(w.chartQuery || {}), yMetrics: [fresh[i]] },
  }));
}

export function isEmptyDataWidget(w: WidgetInstance): boolean {
  if (isNonDataWidget(w.chartType)) return false;
  if (w.chartType === 'image' || w.chartType === 'embed' || w.chartType === 'divider') return false;
  const q = (w.chartQuery || {}) as Record<string, unknown>;
  const sqlBound = Boolean(q.saved_query_id || q.query_snapshot_id || w.chartOptions?.sample_sql);
  return !sqlBound && (!w.dataSourceId || !q.tableName);
}

export function planEmptyWidgetBindings(
  widgets: WidgetInstance[],
  source: { dataSourceId: string; tableName: string },
  columns: ColumnInfo[],
  opts: {
    /** Titles the layout gave its placeholders ("KPI", "Trend"…): only these get replaced. */
    placeholderTitles?: Set<string>;
    humanize?: (field: string) => string;
    /** Metrics other widgets already show, so KPIs pick something new first. */
    taken?: Array<{ field?: string; aggregation?: string }>;
  } = {},
): WidgetBinding[] {
  const measures = columns.filter(isMeasure);
  const dates = columns.filter(isTemporal);
  const categories = columns.filter(isCategory);
  const humanize = opts.humanize ?? ((f: string) => f.replace(/_/g, ' '));
  const metric = (c?: ColumnInfo) =>
    c ? [{ field: c.name, aggregation: 'sum' }] : [{ field: columns[0]?.name ?? '*', aggregation: 'count' }];

  const orderedKpis = kpiCandidates(columns, opts.taken);

  let kpiIndex = 0;
  const out: WidgetBinding[] = [];
  for (const w of widgets.filter(isEmptyDataWidget)) {
    const type = w.chartType;
    const base = { tableName: source.tableName, yMetric: 'count', sortBy: 'x', filters: [], joins: [] };
    let chartQuery: Record<string, unknown>;
    let titleField: string | undefined;

    if (type === 'stat' || type === 'gauge') {
      const m = orderedKpis[kpiIndex % Math.max(orderedKpis.length, 1)];
      kpiIndex += 1;
      chartQuery = { ...base, yMetrics: m ? [m] : metric(undefined) };
      titleField = m?.field;
    } else if (type === 'table') {
      chartQuery = { ...base, x: categories[0]?.name ?? columns[0]?.name, yMetrics: metric(measures[0]) };
    } else {
      const wantsTime = ['line', 'area', 'stacked-area'].includes(type) && dates.length > 0;
      const x = wantsTime ? dates[0] : categories[0] ?? dates[0] ?? columns[0];
      if (!x) continue;
      chartQuery = {
        ...base,
        x: x.name,
        ...(wantsTime ? { xGrain: 'month' } : { sortBy: 'y', sortOrder: 'desc', limit: 12 }),
        yMetrics: metric(measures[0]),
      };
      titleField = measures[0] ? `${measures[0].name}|${x.name}` : undefined;
    }

    const binding: WidgetBinding = { id: w.id, dataSourceId: source.dataSourceId, chartQuery };
    const current = String(w.title || '').trim();
    if (titleField && (!current || opts.placeholderTitles?.has(current))) {
      const [m, x] = titleField.split('|');
      binding.title = x ? `${humanize(m)} · ${humanize(x)}` : humanize(m);
    }
    out.push(binding);
  }
  return out;
}
