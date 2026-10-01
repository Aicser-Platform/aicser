import type { ChartSpec } from '@/services/notebookService';

const DATE_NAME = /(^|_)(date|day|week|month|quarter|year|time|period|created|updated)(_|$|s$|_at$)/i;
const ID_NAME = /(^|_)(id|uuid|key|code|email|phone)$/i;

function isNumber(v: unknown): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
}

function isDateLike(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}.*)?$/.test(v);
}

/** What each column is: a measure, a date, a short category list, or an identifier. */
function profile(columns: string[], rows: unknown[][]) {
  const sample = rows.slice(0, 500);
  const stats = columns.map((name, i) => {
    const values = sample.map((r) => r[i]).filter((v) => v !== null && v !== undefined && v !== '');
    const distinct = new Set(values.map(String)).size;
    return {
      name,
      numeric: values.length > 0 && values.every(isNumber),
      date: DATE_NAME.test(name) || (values.length > 0 && values.every(isDateLike)),
      id: ID_NAME.test(name) || (values.length > 20 && distinct === values.length && !values.every(isNumber)),
      distinct,
    };
  });
  const measures = stats.filter((s) => s.numeric && !s.id && !s.date);
  const date = stats.find((s) => s.date && !s.numeric);
  const categories = stats
    .filter((s) => !s.numeric && !s.date && !s.id && s.distinct >= 2 && s.distinct <= 30)
    .sort((a, b) => a.distinct - b.distinct);
  return { measures, date, categories };
}

/**
 * A readable first chart for a result: dates → a line over time, a short list of categories →
 * bars, otherwise two numbers → a scatter. Identifier columns and high-cardinality text are never
 * put on an axis, so a table of 1,000 customers doesn't become 1,000 unreadable bars.
 */
export function suggestChart(columns: string[], rows: unknown[][]): Pick<ChartSpec, 'x' | 'y' | 'type' | 'agg'> {
  const { measures, date, categories } = profile(columns, rows);
  const category = categories[0];
  const y = measures.slice(0, 2).map((s) => s.name);
  if (date && y.length) return { type: 'line', x: date.name, y, agg: 'sum' };
  if (category && y.length) return { type: 'bar', x: category.name, y: y.slice(0, 1), agg: 'sum' };
  // Categories and no measure: how many rows fall in each.
  if (category) return { type: 'bar', x: category.name, y: [], agg: 'count' };
  if (measures.length >= 2) return { type: 'scatter', x: measures[0].name, y: [measures[1].name], agg: 'none' };
  return { type: 'bar', x: undefined, y, agg: 'sum' };
}

/** A first pivot: the most useful grouping down the side, a second one (or dates) across. */
export function suggestPivot(columns: string[], rows: unknown[][]): Pick<ChartSpec, 'rows' | 'columns' | 'values' | 'agg'> {
  const { measures, date, categories } = profile(columns, rows);
  const down = categories[0]?.name ?? date?.name;
  const across = categories.find((c) => c.name !== down && c.distinct <= 12)?.name;
  return {
    rows: down ? [down] : [],
    columns: across ? [across] : [],
    values: measures.slice(0, 1).map((m) => m.name),
    agg: 'sum',
  };
}
