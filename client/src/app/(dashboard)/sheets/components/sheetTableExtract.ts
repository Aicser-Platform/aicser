import type { Model } from '@ironcalc/workbook';
import type { DataRange } from '@/services/workbookService';
import { areaRef } from './sheetData';

export type SheetTableSourceKind = 'selection' | 'range' | 'sheet';

export type SheetTableDataset = {
  id: string;
  name: string;
  columns: string[];
  rows: unknown[][];
  /** How this table was discovered (for binding UI). */
  sourceKind: SheetTableSourceKind;
  /** Set when `sourceKind === 'range'`. */
  rangeId?: string;
  /** Live SQL range — refresh re-runs the query into the grid. */
  live?: boolean;
};

const MAX_ROWS = 10_000;

function cellText(model: Model, sheet: number, row: number, column: number): string {
  try {
    return String(model.getFormattedCellValue(sheet, row, column) ?? '').trim();
  } catch {
    return '';
  }
}

function cellValue(model: Model, sheet: number, row: number, column: number): unknown {
  const formatted = cellText(model, sheet, row, column);
  if (!formatted) return null;
  const n = Number(formatted.replace(/,/g, ''));
  if (Number.isFinite(n) && /^-?[\d,.]+$/.test(formatted.replace(/,/g, ''))) return n;
  return formatted;
}

export type SheetGridSelection = {
  sheet: number;
  row: number;
  column: number;
  endRow: number;
  endColumn: number;
  label: string;
};

type SelectedView = {
  sheet: number;
  row: number;
  column: number;
  range?: number[];
};

function rowHasData(model: Model, sheet: number, row: number, startCol: number, endCol: number): boolean {
  for (let c = startCol; c <= endCol; c += 1) {
    if (cellText(model, sheet, row, c)) return true;
  }
  return false;
}

/** Excel-like: grow from the active cell to the contiguous header + data block. */
export function expandContiguousTable(
  model: Model,
  sheet: number,
  anchorRow: number,
  anchorCol: number,
  sheetName: (sheet: number) => string,
): SheetGridSelection | null {
  let headerRow = anchorRow;
  while (headerRow > 1 && rowHasData(model, sheet, headerRow - 1, anchorCol, anchorCol)) {
    headerRow -= 1;
  }
  let startCol = anchorCol;
  while (startCol > 1 && cellText(model, sheet, headerRow, startCol - 1)) startCol -= 1;
  let endCol = anchorCol;
  while (endCol < 512 && cellText(model, sheet, headerRow, endCol + 1)) endCol += 1;
  if (!cellText(model, sheet, headerRow, startCol)) return null;

  let endRow = headerRow;
  while (endRow < headerRow + MAX_ROWS && rowHasData(model, sheet, endRow + 1, startCol, endCol)) {
    endRow += 1;
  }
  if (endRow <= headerRow) return null;

  const name = sheetName(sheet);
  const label = areaRef(name, { row: headerRow, column: startCol, width: endCol - startCol + 1, height: endRow - headerRow + 1 });
  return { sheet, row: headerRow, column: startCol, endRow, endColumn: endCol, label };
}

/** Current grid selection from IronCalc (`range` = [row, col, endRow, endCol]). */
export function selectionFromModel(model: Model, sheetName: (sheet: number) => string): SheetGridSelection | null {
  const v = model.getSelectedView() as SelectedView;
  const range = v.range;
  if (!range || range.length < 4) {
    return expandContiguousTable(model, v.sheet, v.row, v.column, sheetName);
  }
  const [row, column, endRow, endColumn] = range;
  if (endRow < row || endColumn < column) return null;
  if (endRow === row && endColumn === column) {
    return expandContiguousTable(model, v.sheet, row, column, sheetName);
  }
  if (endRow - row < 1) return null;
  const name = sheetName(v.sheet);
  const label = areaRef(name, { row, column, width: endColumn - column + 1, height: endRow - row + 1 });
  return { sheet: v.sheet, row, column, endRow, endColumn, label };
}

export function extractTableBox(
  model: Model,
  sheet: number,
  row: number,
  column: number,
  endRow: number,
  endColumn: number,
  label: string,
): SheetTableDataset | null {
  const width = endColumn - column + 1;
  const height = endRow - row + 1;
  if (width < 1 || height < 2) return null;
  const columns: string[] = [];
  for (let c = column; c <= endColumn; c += 1) {
    columns.push(cellText(model, sheet, row, c) || `Column ${c - column + 1}`);
  }
  const rows: unknown[][] = [];
  for (let rowIdx = row + 1; rowIdx <= endRow && rows.length < MAX_ROWS; rowIdx += 1) {
    rows.push(columns.map((_, i) => cellValue(model, sheet, rowIdx, column + i)));
  }
  if (!rows.length) return null;
  return { id: 'selection', name: label, columns, rows, sourceKind: 'selection' };
}

function extractRange(model: Model, r: DataRange, label: string): SheetTableDataset | null {
  if (r.width < 1 || r.height < 2) return null;
  const columns: string[] = [];
  for (let c = r.column; c < r.column + r.width; c += 1) {
    const h = cellText(model, r.sheet, r.row, c);
    columns.push(h || `Column ${c - r.column + 1}`);
  }
  const rows: unknown[][] = [];
  const endRow = r.row + r.height - 1;
  for (let rowIdx = r.row + 1; rowIdx <= endRow && rows.length < MAX_ROWS; rowIdx += 1) {
    rows.push(columns.map((_, i) => cellValue(model, r.sheet, rowIdx, r.column + i)));
  }
  if (!rows.length) return null;
  return {
    id: `range-${r.id}`,
    name: label,
    columns,
    rows,
    sourceKind: 'range',
    rangeId: r.id,
    live: r.mode === 'live',
  };
}

function extractActiveSheetTable(model: Model, sheetIndex: number, sheetLabel: string): SheetTableDataset | null {
  const headerRow = 1;
  const columns: string[] = [];
  for (let c = 1; c <= 120; c += 1) {
    const h = cellText(model, sheetIndex, headerRow, c);
    if (!h) break;
    columns.push(h);
  }
  if (columns.length < 2) return null;

  const rowNums = Array.from(model.getRowsWithData(sheetIndex, 1))
    .filter((r) => r > headerRow)
    .sort((a, b) => a - b)
    .slice(0, MAX_ROWS);

  const rows = rowNums.map((rowIdx) => columns.map((_, i) => cellValue(model, sheetIndex, rowIdx, i + 1)));
  if (!rows.length) return null;
  return { id: `sheet-${sheetIndex}`, name: sheetLabel, columns, rows, sourceKind: 'sheet' };
}

/** When row 1 is not a header (common in imported Excel), find the first dense header row in the data block. */
function discoverHeaderRow(model: Model, sheetIndex: number, rowNums: number[]): number | null {
  if (!rowNums.length) return null;
  const min = rowNums[0];
  const max = rowNums[rowNums.length - 1];
  const scanEnd = Math.min(min + 120, max);
  for (let r = min; r <= scanEnd; r += 1) {
    let filled = 0;
    for (let c = 1; c <= 48; c += 1) {
      if (cellText(model, sheetIndex, r, c)) filled += 1;
    }
    if (filled < 3) continue;
    let below = 0;
    for (let c = 1; c <= 48; c += 1) {
      if (cellText(model, sheetIndex, r + 1, c)) below += 1;
    }
    if (below >= 2) return r;
  }
  return min;
}

export function extractDiscoveredSheetTable(model: Model, sheetIndex: number, sheetLabel: string): SheetTableDataset | null {
  let rowNums: number[] = [];
  try {
    rowNums = Array.from(model.getRowsWithData(sheetIndex, 1)).sort((a, b) => a - b);
  } catch {
    return null;
  }
  if (rowNums.length < 3) return null;

  const headerRow = discoverHeaderRow(model, sheetIndex, rowNums);
  if (!headerRow) return null;

  const columns: string[] = [];
  for (let c = 1; c <= 120; c += 1) {
    const h = cellText(model, sheetIndex, headerRow, c);
    if (!h) break;
    columns.push(h);
  }
  if (columns.length < 2) return null;

  const dataRows = rowNums.filter((r) => r > headerRow).slice(0, MAX_ROWS);
  const rows = dataRows.map((rowIdx) => columns.map((_, i) => cellValue(model, sheetIndex, rowIdx, i + 1)));
  if (!rows.length) return null;

  const endRow = dataRows[dataRows.length - 1];
  const label = areaRef(sheetLabel, {
    row: headerRow,
    column: 1,
    width: columns.length,
    height: endRow - headerRow + 1,
  });
  return { id: `sheet-${sheetIndex}-discovered`, name: label, columns, rows, sourceKind: 'sheet' };
}

/** Tables for pivot/chart: current selection first, then live ranges, then sheet row 1 headers. */
export function extractSheetTableDatasets(
  model: Model | null,
  ranges: DataRange[],
  sheetName: (sheet: number) => string,
  gridSelection?: SheetGridSelection | null,
): SheetTableDataset[] {
  if (!model) return [];
  const out: SheetTableDataset[] = [];
  const sel = gridSelection ?? selectionFromModel(model, sheetName);
  if (sel) {
    const fromSel = extractTableBox(model, sel.sheet, sel.row, sel.column, sel.endRow, sel.endColumn, sel.label);
    if (fromSel) out.push(fromSel);
  }
  ranges.forEach((r, idx) => {
    const ds = extractRange(model, r, r.name || `Range ${idx + 1} (${sheetName(r.sheet)})`);
    if (ds && !out.some((x) => x.id === ds.id)) out.push({ ...ds, id: `range-${r.id}` });
  });
  if (!out.length) {
    try {
      const sheet = model.getSelectedSheet?.() ?? 0;
      const label = sheetName(sheet);
      const active = extractActiveSheetTable(model, sheet, label);
      if (active) out.push(active);
      else {
        const discovered = extractDiscoveredSheetTable(model, sheet, label);
        if (discovered) out.push(discovered);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function selectionAnchorLabel(sel: SheetGridSelection | null | undefined): string | null {
  if (!sel) return null;
  return sel.label;
}
