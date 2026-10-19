/**
 * Workbook-wide context for AI formula generation (all tabs, tables, live ranges).
 */

import type { Model } from '@ironcalc/workbook';
import type { DataRange } from '@/services/workbookService';
import { areaRef, columnLetters } from './sheetData';
import {
  extractDiscoveredSheetTable,
  extractSheetTableDatasets,
  selectionFromModel,
} from './sheetTableExtract';
import { summarizeWorkbookSheets } from '@/agent/sheetSurfaceContext';

const ACTIVE_GRID_ROWS = 80;
const ACTIVE_GRID_COLS = 40;
const TABLE_SAMPLE_ROWS = 12;
const MAX_TABLES = 24;

export type FormulaRangeDesc = {
  name: string;
  area: string;
  header_row: number;
  columns: string[];
  mode?: string;
  sql_preview?: string;
};

export type FormulaTableDesc = {
  sheet: string;
  name: string;
  area: string;
  columns: string[];
  row_count: number;
  sample_rows: unknown[][];
};

export function buildWorkbookFormulaContext(
  model: Model,
  ranges: DataRange[],
  sheetName: (sheet: number) => string,
): {
  grid: string;
  ranges: FormulaRangeDesc[];
  sheets: Array<Record<string, unknown>>;
  tables: FormulaTableDesc[];
  workbook_summary: string;
} {
  const view = model.getSelectedView();
  const activeSheet = view.sheet;
  const lines: string[] = [];
  for (let r = 1; r <= ACTIVE_GRID_ROWS; r += 1) {
    for (let c = 1; c <= ACTIVE_GRID_COLS; c += 1) {
      const raw = model.getCellContent(activeSheet, r, c);
      const v = raw.startsWith("'") ? raw.slice(1) : raw;
      if (v !== '') {
        lines.push(`${sheetName(activeSheet)}!${columnLetters(c)}${r}: ${v.slice(0, 120)}`);
      }
    }
  }

  const described: FormulaRangeDesc[] = ranges.map((x) => ({
    name: x.name || 'data',
    area: areaRef(sheetName(x.sheet), x),
    header_row: x.row,
    columns: Array.from({ length: x.width }, (_, i) =>
      String(model.getFormattedCellValue(x.sheet, x.row, x.column + i) ?? '').trim(),
    ),
    mode: x.mode,
    sql_preview: x.sql ? String(x.sql).slice(0, 280) : undefined,
  }));

  const sheets = summarizeWorkbookSheets(model, sheetName);
  const tables: FormulaTableDesc[] = [];
  const props = model.getWorksheetsProperties();
  for (let i = 0; i < props.length && tables.length < MAX_TABLES; i += 1) {
    try {
      const label = sheetName(i);
      const discovered = extractDiscoveredSheetTable(model, i, label);
      if (discovered) {
        tables.push({
          sheet: label,
          name: discovered.name,
          area: discovered.name,
          columns: discovered.columns,
          row_count: discovered.rows.length,
          sample_rows: discovered.rows.slice(0, TABLE_SAMPLE_ROWS),
        });
      }
    } catch {
      /* sheet table discovery is best-effort */
    }
  }

  const sel = selectionFromModel(model, sheetName);
  const localDatasets = extractSheetTableDatasets(model, ranges, sheetName, sel);
  for (const d of localDatasets) {
    if (tables.some((t) => t.name === d.name)) continue;
    tables.push({
      sheet: sheetName(activeSheet),
      name: d.name,
      area: d.name,
      columns: d.columns,
      row_count: d.rows.length,
      sample_rows: d.rows.slice(0, TABLE_SAMPLE_ROWS),
    });
  }

  const liveCount = ranges.filter((r) => r.mode === 'live').length;
  const workbook_summary = [
    `${props.length} sheet(s)`,
    `${tables.length} detected table(s)`,
    `${ranges.length} data range(s) (${liveCount} live)`,
  ].join(' · ');

  return {
    grid: lines.join('\n'),
    ranges: described,
    sheets,
    tables,
    workbook_summary,
  };
}
