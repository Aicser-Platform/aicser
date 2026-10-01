/**
 * Turning a result into what a chart or pivot table shows: rows grouped by a category (and an
 * optional series column), summarised (sum, average, count, min, max), sorted and capped with the
 * rest folded into "Other". Pure functions, so charts, pivots and exports agree on every number.
 */

export type Agg = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';
export const AGGS: Agg[] = ['sum', 'avg', 'count', 'min', 'max', 'none'];

type Acc = { sum: number; count: number; min: number; max: number; n: number };

const newAcc = (): Acc => ({ sum: 0, count: 0, min: Infinity, max: -Infinity, n: 0 });

function add(acc: Acc, v: unknown) {
  acc.count += 1;
  const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (Number.isFinite(num)) {
    acc.sum += num;
    acc.n += 1;
    if (num < acc.min) acc.min = num;
    if (num > acc.max) acc.max = num;
  }
}

export function finish(acc: Acc | undefined, agg: Agg): number | null {
  if (!acc) return null;
  switch (agg) {
    case 'count': return acc.count;
    case 'avg': return acc.n ? acc.sum / acc.n : null;
    case 'min': return acc.n ? acc.min : null;
    case 'max': return acc.n ? acc.max : null;
    default: return acc.n ? acc.sum : null;
  }
}

export function label(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const isNumeric = (values: unknown[]) => values.length > 0 && values.every((v) => v !== null && v !== '' && Number.isFinite(Number(v)));
const isDateLike = (values: unknown[]) => values.length > 0 && values.every((v) => typeof v === 'string' && /^\d{4}-\d{2}/.test(v));

export type Shaped = {
  categories: string[];
  series: Array<{ name: string; data: Array<number | null> }>;
  /** How many categories there were before folding. */
  total: number;
  numericX: boolean;
};

export function shapeChart(
  columns: string[],
  rows: unknown[][],
  spec: { x?: string; y?: string[]; agg?: Agg; series?: string | null; sort?: 'value' | 'label' | 'none'; limit?: number; fold?: boolean },
  otherLabel = 'Other',
): Shaped {
  const xi = spec.x ? columns.indexOf(spec.x) : -1;
  const yis = (spec.y ?? []).map((y) => ({ name: y, i: columns.indexOf(y) })).filter((y) => y.i >= 0);
  const si = spec.series ? columns.indexOf(spec.series) : -1;
  const xValues = xi >= 0 ? rows.slice(0, 500).map((r) => r[xi]).filter((v) => v !== null && v !== '') : [];
  const numericX = isNumeric(xValues);
  const agg: Agg = spec.agg ?? 'none';

  // No summarising: every row is a point, in the order given.
  if (agg === 'none' || xi < 0) {
    const categories = rows.map((r) => (xi >= 0 ? label(r[xi]) : ''));
    return {
      categories,
      series: yis.map((y) => ({ name: y.name, data: rows.map((r) => (r[y.i] == null || r[y.i] === '' ? null : Number(r[y.i]))) })),
      total: categories.length,
      numericX,
    };
  }

  // Group by x (and the split column); one series per measure, or per split value.
  const groups = new Map<string, Map<string, Acc>>();
  const seriesNames: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const cat = label(r[xi]);
    let byCat = groups.get(cat);
    if (!byCat) {
      byCat = new Map();
      groups.set(cat, byCat);
    }
    const measures = yis.length ? yis : [{ name: 'count', i: -1 }];
    for (const y of measures) {
      const name = si >= 0 ? (yis.length > 1 ? `${label(r[si])} · ${y.name}` : label(r[si])) : y.name;
      if (!seen.has(name)) {
        seen.add(name);
        seriesNames.push(name);
      }
      let acc = byCat.get(name);
      if (!acc) {
        acc = newAcc();
        byCat.set(name, acc);
      }
      add(acc, y.i >= 0 ? r[y.i] : 1);
    }
  }
  const effectiveAgg: Agg = yis.length ? agg : 'count';
  let categories = Array.from(groups.keys());
  const totalOf = (cat: string) => seriesNames.reduce((t, s) => t + (finish(groups.get(cat)!.get(s), effectiveAgg) ?? 0), 0);
  const dateX = isDateLike(xValues);
  const sort = spec.sort ?? (numericX || dateX ? 'label' : 'value');
  if (sort === 'value') categories.sort((a, b) => totalOf(b) - totalOf(a));
  else if (sort === 'label') {
    categories.sort((a, b) => (numericX ? Number(a) - Number(b) : a.localeCompare(b, undefined, { numeric: true })));
  }
  const total = categories.length;
  const limit = spec.limit ?? 0;
  let other: string[] = [];
  if (limit > 0 && categories.length > limit) {
    if (spec.fold === false) {
      categories = categories.slice(0, limit); // top N only (bars): an "Other" bar dwarfs the rest
    } else {
      other = categories.slice(limit - 1);
      categories = categories.slice(0, limit - 1);
    }
  }
  // Folding re-aggregates the tail's rows only for additive summaries; others show just the top.
  const foldable = effectiveAgg === 'sum' || effectiveAgg === 'count';
  const series = seriesNames.map((name) => {
    const data = categories.map((c) => finish(groups.get(c)!.get(name), effectiveAgg));
    if (other.length && foldable) data.push(other.reduce((t, c) => t + (finish(groups.get(c)!.get(name), effectiveAgg) ?? 0), 0));
    return { name, data };
  });
  if (other.length && foldable) categories = [...categories, otherLabel];
  return { categories, series, total, numericX };
}

// ── Pivot table ─────────────────────────────────────────────────────────────

export type PivotSpec = {
  from?: string;
  rows?: string[];
  columns?: string[];
  values?: string[];
  agg?: Agg;
};

export type Pivot = {
  /** Header of each row-dimension column. */
  rowHeaders: string[];
  /** Column keys (one per column value × measure), with their labels. */
  colKeys: Array<{ key: string; col: string | null; measure: string }>;
  body: Array<{ keys: string[]; cells: Array<number | null>; total: number | null }>;
  totals: Array<number | null>;
  grand: number | null;
  truncated: boolean;
};

const MAX_PIVOT_ROWS = 1000;
const MAX_PIVOT_COLS = 60;

export function pivot(columns: string[], rows: unknown[][], spec: PivotSpec): Pivot {
  const ri = (spec.rows ?? []).map((c) => columns.indexOf(c)).filter((i) => i >= 0);
  const ci = (spec.columns ?? []).map((c) => columns.indexOf(c)).filter((i) => i >= 0);
  const measures = (spec.values ?? []).map((v) => ({ name: v, i: columns.indexOf(v) })).filter((m) => m.i >= 0);
  const agg: Agg = measures.length ? (spec.agg && spec.agg !== 'none' ? spec.agg : 'sum') : 'count';
  const ms = measures.length ? measures : [{ name: 'count', i: -1 }];

  const cells = new Map<string, Map<string, Acc>>();
  const rowTotals = new Map<string, Acc>();
  const colTotals = new Map<string, Acc>();
  const grand = newAcc();
  const rowKeys = new Map<string, string[]>();
  const colVals: string[] = [];
  const colSeen = new Set<string>();

  for (const r of rows) {
    const keys = ri.map((i) => label(r[i]));
    const rk = JSON.stringify(keys);
    if (!rowKeys.has(rk)) rowKeys.set(rk, keys);
    const cv = ci.length ? ci.map((i) => label(r[i])).join(' · ') : null;
    if (cv !== null && !colSeen.has(cv)) {
      colSeen.add(cv);
      colVals.push(cv);
    }
    for (const m of ms) {
      const v = m.i >= 0 ? r[m.i] : 1;
      const ck = `${cv ?? ''}\u0000${m.name}`;
      let row = cells.get(rk);
      if (!row) cells.set(rk, (row = new Map()));
      let acc = row.get(ck);
      if (!acc) row.set(ck, (acc = newAcc()));
      add(acc, v);
      if (ms.length === 1) {
        let rt = rowTotals.get(rk);
        if (!rt) rowTotals.set(rk, (rt = newAcc()));
        add(rt, v);
        add(grand, v);
      }
      let ct = colTotals.get(ck);
      if (!ct) colTotals.set(ck, (ct = newAcc()));
      add(ct, v);
    }
  }

  colVals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const shownCols = colVals.slice(0, MAX_PIVOT_COLS);
  const colKeys = (ci.length ? shownCols : [null]).flatMap((col) =>
    ms.map((m) => ({ key: `${col ?? ''}\u0000${m.name}`, col, measure: m.name })),
  );
  const sortedRows = Array.from(rowKeys.entries()).sort((a, b) => {
    for (let k = 0; k < a[1].length; k += 1) {
      const d = a[1][k].localeCompare(b[1][k], undefined, { numeric: true });
      if (d) return d;
    }
    return 0;
  });
  const body = sortedRows.slice(0, MAX_PIVOT_ROWS).map(([rk, keys]) => ({
    keys,
    cells: colKeys.map((c) => finish(cells.get(rk)?.get(c.key), agg)),
    total: ms.length === 1 && ci.length ? finish(rowTotals.get(rk), agg) : null,
  }));
  return {
    rowHeaders: spec.rows?.filter((c) => columns.includes(c)) ?? [],
    colKeys,
    body,
    totals: colKeys.map((c) => finish(colTotals.get(c.key), agg)),
    grand: ms.length === 1 && ci.length ? finish(grand, agg) : null,
    truncated: sortedRows.length > MAX_PIVOT_ROWS || colVals.length > MAX_PIVOT_COLS,
  };
}
