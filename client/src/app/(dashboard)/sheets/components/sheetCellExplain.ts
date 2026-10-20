import type { Model } from '@ironcalc/workbook';
import { columnLetters } from './sheetData';

/** Snapshot of the active cell for explain / translate API calls. */
export function selectedCellExplainPayload(
  model: Model,
  sheetName: (sheet: number) => string,
) {
  const v = model.getSelectedView();
  const raw = model.getCellContent(v.sheet, v.row, v.column);
  const display = String(model.getFormattedCellValue(v.sheet, v.row, v.column) ?? '').trim();
  const formula = raw.startsWith('=') ? raw : null;
  const neighbors: string[] = [];
  const r0 = Math.max(1, v.row - 2);
  const r1 = Math.min(v.row + 2, v.row + 15);
  const c0 = Math.max(1, v.column - 3);
  const c1 = Math.min(v.column + 8, 40);
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const content = model.getCellContent(v.sheet, r, c);
      const val = content.startsWith("'") ? content.slice(1) : content;
      if (!val) continue;
      neighbors.push(`${sheetName(v.sheet)}!${columnLetters(c)}${r}: ${val.slice(0, 100)}`);
    }
  }
  return {
    sheet: sheetName(v.sheet),
    cell: `${columnLetters(v.column)}${v.row}`,
    cell_formula: formula,
    cell_value: display || (formula ? '(formula)' : ''),
    neighbors: neighbors.join('\n'),
  };
}
