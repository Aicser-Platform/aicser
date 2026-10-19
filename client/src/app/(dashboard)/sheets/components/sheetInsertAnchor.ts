import type { Model } from '@ironcalc/workbook';
import type { Shaped } from '@/app/(dashboard)/notebooks/components/chartShape';
import type { SheetGridSelection } from './sheetTableExtract';

export type SheetInsertPlacement = 'active_cell' | 'below_selection' | 'new_sheet';

type SelectedView = {
  sheet: number;
  row: number;
  column: number;
  range?: number[];
};

function uniqueSheetName(model: Model, base: string): string {
  const names = new Set(model.getWorksheetsProperties().map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/** Where to write pivot/chart output: follows the live cursor, below the analyzed block, or a new tab. */
export function resolveSheetWriteAnchor(
  model: Model,
  placement: SheetInsertPlacement,
  gridSelection?: SheetGridSelection | null,
  newSheetBaseName?: string,
): { sheet: number; row: number; column: number } {
  if (placement === 'new_sheet') {
    model.newSheet();
    const sheet = model.getSelectedSheet();
    if (newSheetBaseName) {
      model.renameSheet(sheet, uniqueSheetName(model, newSheetBaseName));
    }
    return { sheet, row: 1, column: 1 };
  }

  const v = model.getSelectedView() as SelectedView;
  const sheet = v.sheet;

  if (placement === 'below_selection' && gridSelection) {
    return {
      sheet: gridSelection.sheet,
      row: gridSelection.endRow + 2,
      column: gridSelection.column,
    };
  }

  const range = v.range;
  if (range && range.length >= 4) {
    return { sheet, row: range[0], column: range[1] };
  }
  return { sheet, row: v.row, column: v.column };
}

export function shapedChartToGrid(shaped: Shaped, categoryHeader: string): { columns: string[]; rows: unknown[][] } {
  const columns = [categoryHeader, ...shaped.series.map((s) => s.name)];
  const rows = shaped.categories.map((cat, i) => [
    cat,
    ...shaped.series.map((s) => s.data[i] ?? ''),
  ]);
  return { columns, rows };
}
