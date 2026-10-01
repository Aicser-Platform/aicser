/**
 * Writing query results into a sheet. Each column is typed from its values, so numbers stay
 * numbers (sums work), dates are real dates, and everything else is written as text — with a
 * leading apostrophe, so a value like "=HYPERLINK(…)" or "+1" from a data source can never
 * become a formula (spreadsheet formula injection).
 */
import type { Model } from '@ironcalc/wasm';

export type ColumnKind = 'number' | 'bool' | 'date' | 'datetime' | 'text';

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
export const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

const present = (v: unknown) => v !== null && v !== undefined && v !== '';

function kindOf(v: unknown): ColumnKind {
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : 'text';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') {
    // "00123" (codes, zip codes) keeps its zeros as text.
    if (NUMBER.test(v)) return 'number';
    if (DATE.test(v)) return 'date';
    const m = v.match(DATETIME);
    if (m) return Number(m[2]) === 0 && Number(m[3]) === 0 && Number(m[4] ?? 0) === 0 ? 'date' : 'datetime';
  }
  return 'text';
}

/** One kind per column: the kind every present value shares, else text. */
export function columnKinds(columns: string[], rows: unknown[][]): ColumnKind[] {
  return columns.map((_, c) => {
    let kind: ColumnKind | null = null;
    for (const row of rows) {
      const v = row[c];
      if (!present(v)) continue;
      let k = kindOf(v);
      if (kind && k !== kind) {
        if ((kind === 'date' && k === 'datetime') || (kind === 'datetime' && k === 'date')) k = 'datetime';
        else return 'text';
      }
      kind = k;
    }
    return kind ?? 'text';
  });
}

/** Days since 1899-12-30 (the spreadsheet date serial), wall-clock time as written. */
export function serialOf(value: string): number | null {
  const m = value.match(DATETIME) ?? value.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  const days = (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  const h = Number(m[2] ?? 0), mi = Number(m[3] ?? 0), s = Number(m[4] ?? 0);
  return days + (h * 3600 + mi * 60 + s) / 86400;
}

/** The text to type into a cell for this value, or null to leave it empty. */
export function cellInput(value: unknown, kind: ColumnKind): string | null {
  if (!present(value)) return null;
  switch (kind) {
    case 'number':
      return String(Number(value));
    case 'bool':
      return value ? 'TRUE' : 'FALSE';
    case 'date':
      return String(value).slice(0, 10);
    case 'datetime': {
      const serial = serialOf(String(value));
      return serial === null ? `'${String(value)}` : String(serial);
    }
    default:
      return `'${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
  }
}

export type Written = { width: number; height: number };

/**
 * Put a table at (row, column) of a sheet: a bold header row, then the values. Evaluation is
 * paused while writing, so 200k cells take about a second.
 */
export function writeTable(
  model: Model, sheet: number, row: number, column: number, columns: string[], rows: unknown[][],
): Written {
  const kinds = columnKinds(columns, rows);
  model.pauseEvaluation();
  try {
    columns.forEach((name, c) => model.setUserInput(sheet, row, column + c, `'${name}`));
    rows.forEach((values, r) => {
      kinds.forEach((kind, c) => {
        const input = cellInput(values[c], kind);
        if (input !== null) model.setUserInput(sheet, row + 1 + r, column + c, input);
      });
    });
  } finally {
    model.resumeEvaluation();
  }
  if (columns.length) {
    model.updateRangeStyle({ sheet, row, column, width: columns.length, height: 1 }, 'font.b', 'true');
  }
  kinds.forEach((kind, c) => {
    if (kind === 'datetime' && rows.length) {
      model.updateRangeStyle({ sheet, row: row + 1, column: column + c, width: 1, height: rows.length }, 'num_fmt', DATETIME_FORMAT);
    }
  });
  model.evaluate();
  return { width: columns.length, height: rows.length + 1 };
}

/** Empty the cells a range used before it is rewritten (values and formats). */
export function clearArea(model: Model, sheet: number, row: number, column: number, width: number, height: number): void {
  if (width > 0 && height > 0) model.rangeClearAll(sheet, row, column, row + height - 1, column + width - 1);
}
