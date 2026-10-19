import type { PrepStep, TypeSpec } from '@/api/prep';
import { stepParts } from '@/api/prep';

/** Types offered in "Change type", in plain words; dates and numbers read messy text. */
export const COLUMN_TYPES = ['text', 'integer', 'number', 'decimal', 'boolean', 'date', 'datetime'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const NULL_TOKENS = ['', 'NA', 'N/A', 'n/a', 'null', 'NULL', 'None', '-', 'NaN', '#N/A'];

export const quoteColumn = (name: string) => `"${name.replace(/"/g, '""')}"`;

export type Convention = 'snake' | 'title' | 'camel' | 'lower' | 'upper';

const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^0-9A-Za-zÀ-￿]+/)
    .filter(Boolean);

export function convertName(name: string, convention: Convention): string {
  const w = words(name);
  if (!w.length) return name;
  switch (convention) {
    case 'snake':
      return w.map((x) => x.toLowerCase()).join('_');
    case 'title':
      return w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' ');
    case 'camel':
      return w.map((x, i) => (i === 0 ? x.toLowerCase() : x[0].toUpperCase() + x.slice(1).toLowerCase())).join('');
    case 'lower':
      return name.toLowerCase();
    case 'upper':
      return name.toUpperCase();
  }
}

/** A rename mapping for every column whose name changes; null when names would collide. */
export function renameAllMapping(columns: string[], convention: Convention): Record<string, string> | null {
  const mapping: Record<string, string> = {};
  const targets = columns.map((c) => convertName(c, convention));
  if (new Set(targets).size !== targets.length) return null;
  columns.forEach((c, i) => {
    if (targets[i] !== c) mapping[c] = targets[i];
  });
  return mapping;
}

export const steps = {
  rename: (column: string, to: string): PrepStep => ({ rename: { columns: { [column]: to } } }),
  renameMany: (mapping: Record<string, string>, note?: string): PrepStep => ({ rename: { columns: mapping, ...(note ? { note } : {}) } }),
  setType: (columns: string[], spec: TypeSpec): PrepStep => {
    const clean: Record<string, unknown> = { type: spec.type };
    if (spec.formats?.length) clean.formats = spec.formats;
    if (spec.locale) clean.locale = spec.locale;
    if (spec.excel_serial) clean.excel_serial = true;
    return { set_types: { columns: Object.fromEntries(columns.map((c) => [c, clean])) } };
  },
  remove: (columns: string[]): PrepStep => ({ drop: { columns } }),
  keepOnly: (columns: string[]): PrepStep => ({ select: { columns } }),
  trim: (columns: string[]): PrepStep => ({ clean: { columns, trim: true } }),
  emptyMarkers: (columns: string[]): PrepStep => ({ clean: { columns, nulls: NULL_TOKENS, trim: true } }),
  stripCurrency: (columns: string[]): PrepStep => ({ clean: { columns, currency: true } }),
  changeCase: (columns: string[], kase: 'upper' | 'lower' | 'title' | 'sentence'): PrepStep => ({
    change_case: { columns, case: kase },
  }),
  replace: (
    columns: string[],
    pairs: Record<string, string>,
    match: 'contains' | 'whole' | 'regex',
    caseSensitive: boolean,
  ): PrepStep => ({ replace: { columns, mapping: pairs, match, case_sensitive: caseSensitive } }),
  fill: (columns: string[], strategy: string, value?: string | number): PrepStep => ({
    fill: { columns, strategy, ...(strategy === 'value' ? { value } : {}) },
  }),
  split: (column: string, opts: { mode: string; delimiter?: string; positions?: number[]; into?: string[]; parts?: number }): PrepStep => ({
    split: { column, ...opts },
  }),
  extract: (column: string, pattern: string, into: string, groupIndex = 0): PrepStep => ({
    extract: { column, pattern, into, group_index: groupIndex },
  }),
  parseDate: (columns: string[], formats: string[], withTime = false): PrepStep => ({
    parse_date: { columns, formats, with_time: withTime },
  }),
  parseNumber: (columns: string[], locale: 'us' | 'eu'): PrepStep => ({ parse_number: { columns, locale } }),
  mask: (columns: string[], method: 'hash' | 'last4' | 'redact'): PrepStep => ({ mask: { columns, method } }),
  dedupeBy: (columns: string[]): PrepStep => ({ dedupe: { keys: columns } }),
  dedupeRows: (): PrepStep => ({ dedupe: {} }),
  sort: (column: string, desc: boolean): PrepStep => ({ sort: { by: [column], desc } }),
  removeEmptyRows: (columns: string[]): PrepStep => ({
    filter_rows: { conditions: columns.map((column) => ({ column, op: 'not_empty' })), match: 'all', action: 'keep' },
  }),
  flattenJson: (column: string, fields: Record<string, string>): PrepStep => ({ flatten_json: { column, fields } }),
  explode: (column: string): PrepStep => ({ explode: { column } }),
  concat: (columns: string[], into: string, separator: string): PrepStep => ({ concat: { columns, into, separator } }),
  formula: (into: string, expression: string, language: 'excel' | 'sql', replace = false): PrepStep => ({
    formula: { into, expression, language, ...(replace ? { replace: true } : {}) },
  }),
};

/**
 * Add a step, folding it into the previous one when that is the same simple edit
 * (two renames become one "Renamed columns" step, as in Power Query).
 */
export function appendStep(list: PrepStep[], next: PrepStep): PrepStep[] {
  const last = list[list.length - 1];
  if (last) {
    const [lastKind, lastArgs] = stepParts(last);
    const [nextKind, nextArgs] = stepParts(next);
    const plain = !lastArgs.note && !lastArgs.disabled && !nextArgs.note;
    if (plain && lastKind === nextKind && (nextKind === 'rename' || nextKind === 'cast' || nextKind === 'set_types')) {
      const merged = {
        ...(lastArgs.columns as Record<string, unknown>),
        ...(nextArgs.columns as Record<string, unknown>),
      };
      return [...list.slice(0, -1), { [nextKind]: { columns: merged } }];
    }
    if (plain && lastKind === 'drop' && nextKind === 'drop') {
      const columns = Array.from(new Set([...(lastArgs.columns as string[]), ...(nextArgs.columns as string[])]));
      return [...list.slice(0, -1), { drop: { columns } }];
    }
  }
  return [...list, next];
}

export function moveStep(list: PrepStep[], index: number, delta: -1 | 1): PrepStep[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const out = [...list];
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/** Columns a step reads, for "this step uses column X" hints. */
export function stepColumns(step: PrepStep): string[] {
  const [, args] = stepParts(step);
  const cols = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') cols.add(v);
    if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && cols.add(x));
  };
  add(args.column);
  add(args.columns && !Array.isArray(args.columns) ? Object.keys(args.columns as object) : args.columns);
  add(args.keys);
  add(args.by);
  if (args.values && typeof args.values === 'object') add(Object.keys(args.values as object));
  return Array.from(cols);
}

/** A short plain-language description of a step, with the columns it touches. */
export function describeStep(step: PrepStep, label: (kind: string) => string): string {
  const [kind] = stepParts(step);
  const cols = stepColumns(step);
  const shown = cols.slice(0, 3).join(', ') + (cols.length > 3 ? ` +${cols.length - 3}` : '');
  return shown ? `${label(kind)}: ${shown}` : label(kind);
}

/** Friendly name for an engine column type (int64 → Whole number). */
export function friendlyType(engineType: string): ColumnType | 'other' {
  const t = engineType.toLowerCase();
  if (/bool/.test(t)) return 'boolean';
  if (/timestamp|datetime/.test(t)) return 'datetime';
  if (/date/.test(t)) return 'date';
  if (/decimal/.test(t)) return 'decimal';
  if (/int/.test(t)) return 'integer';
  if (/double|float|real|numeric/.test(t)) return 'number';
  if (/string|varchar|text|utf8|large_string/.test(t)) return 'text';
  return 'other';
}
