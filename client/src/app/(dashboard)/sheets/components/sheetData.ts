/**
 * Live data ranges: a query's result written into a sheet, re-run as the viewer on refresh
 * through the same governed query endpoint as the SQL editor and notebooks (row security,
 * column masking and the pre-execution checks all apply to whoever refreshes).
 */
import { enhancedDataService } from '@/services/enhancedDataService';
import type { DataRange } from '@/services/workbookService';

/** A sheet holds analysis-sized results, not whole tables: bigger results are cut here and
 * flagged, with the query one click away for the rest. */
export const MAX_RANGE_ROWS = 50_000;

export type QueryResult = { columns: string[]; rows: unknown[][]; total: number };

export async function runRangeQuery(sql: string, dataSourceId: string, projectId: string | null, signal?: AbortSignal): Promise<QueryResult> {
  const res = await enhancedDataService.executeMultiEngineQuery(sql, dataSourceId, undefined, true, signal, projectId ?? undefined);
  if (!res.success) throw new Error(res.error || 'The query failed.');
  const named = ((res.columns || []) as Array<string | { name: string }>).map((c) => (typeof c === 'string' ? c : c.name));
  const columns = named.length ? named : Object.keys((res.data?.[0] as Record<string, unknown>) || {});
  const all = (res.data || []).map((r: unknown) => (Array.isArray(r) ? r : columns.map((c) => (r as Record<string, unknown>)[c])));
  return { columns, rows: all.slice(0, MAX_RANGE_ROWS), total: Math.max(res.row_count || 0, all.length) };
}

export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function tableQuery(table: string): string {
  return `SELECT *\nFROM ${table.split('.').map(quoteIdent).join('.')}\nLIMIT ${MAX_RANGE_ROWS}`;
}

export function columnLetters(column: number): string {
  let n = column;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellRef(sheetName: string, row: number, column: number): string {
  const sheet = /^[A-Za-z0-9_]+$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  return `${sheet}!${columnLetters(column)}${row}`;
}

export function areaRef(sheetName: string, r: Pick<DataRange, 'row' | 'column' | 'width' | 'height'>): string {
  const end = `${columnLetters(r.column + Math.max(r.width, 1) - 1)}${r.row + Math.max(r.height, 1) - 1}`;
  return `${cellRef(sheetName, r.row, r.column)}:${end}`;
}

type Box = { sheet: number; row: number; column: number; width: number; height: number };

export function overlaps(a: Box, b: Box): boolean {
  return a.sheet === b.sheet
    && a.row < b.row + Math.max(b.height, 1) && b.row < a.row + Math.max(a.height, 1)
    && a.column < b.column + Math.max(b.width, 1) && b.column < a.column + Math.max(a.width, 1);
}

export function newRangeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Data handed over by "Open as workbook" for a snapshot range (a notebook's Python result). */
export function seedKey(workbookId: string, rangeId: string): string {
  return `aicser.workbook.seed.${workbookId}.${rangeId}`;
}
