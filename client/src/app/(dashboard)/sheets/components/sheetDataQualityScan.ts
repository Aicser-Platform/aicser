import type { Model } from '@ironcalc/workbook';

const MAX_COLS = 32;
const MAX_SAMPLE_ROWS = 250;
const HEADER_ROW = 1;

function cellRaw(model: Model, sheet: number, row: number, column: number): string {
  try {
    return String(model.getFormattedCellValue(sheet, row, column) ?? '');
  } catch {
    return '';
  }
}

function cellTrimmed(model: Model, sheet: number, row: number, column: number): string {
  return cellRaw(model, sheet, row, column).trim();
}

function isNumericLike(text: string): boolean {
  const t = text.replace(/,/g, '').trim();
  return t.length > 0 && Number.isFinite(Number(t)) && /^-?[\d,.]+$/.test(t);
}

export type ColumnQualityHint = {
  name: string;
  empty_pct: number;
  mixed_types: boolean;
  whitespace_issues: number;
  sample_distinct: number;
};

export type SheetQualityProfile = {
  sheet_index: number;
  sheet_name: string;
  column_count: number;
  row_sample_count: number;
  columns: ColumnQualityHint[];
  issues: string[];
};

export type WorkbookQualitySnapshot = {
  sheets: SheetQualityProfile[];
  cross_sheet: {
    shared_column_names: string[];
    notes: string[];
  };
};

function scanSheet(model: Model, sheetIndex: number, sheetName: string): SheetQualityProfile | null {
  const headers: string[] = [];
  for (let c = 1; c <= MAX_COLS; c += 1) {
    const h = cellTrimmed(model, sheetIndex, HEADER_ROW, c);
    if (!h) break;
    headers.push(h);
  }
  if (headers.length < 2) return null;

  let rowNums: number[] = [];
  try {
    rowNums = Array.from(model.getRowsWithData(sheetIndex, 1))
      .filter((r) => r > HEADER_ROW)
      .sort((a, b) => a - b);
  } catch {
    return null;
  }
  if (!rowNums.length) return null;

  const sampleRows = rowNums.slice(0, MAX_SAMPLE_ROWS);
  const columns: ColumnQualityHint[] = [];
  const issues: string[] = [];

  headers.forEach((name, colIdx) => {
    const column = colIdx + 1;
    let empty = 0;
    let numeric = 0;
    let text = 0;
    let whitespace = 0;
    const values = new Set<string>();

    for (const row of sampleRows) {
      const raw = cellRaw(model, sheetIndex, row, column);
      const trimmed = raw.trim();
      if (!trimmed) {
        empty += 1;
        continue;
      }
      if (raw !== trimmed && (raw.startsWith(' ') || raw.endsWith(' '))) whitespace += 1;
      values.add(trimmed.toLowerCase());
      if (isNumericLike(trimmed)) numeric += 1;
      else text += 1;
    }

    const n = sampleRows.length;
    const emptyPct = n ? Math.round((empty / n) * 100) : 0;
    const mixed = numeric > 0 && text > 0;
    columns.push({
      name,
      empty_pct: emptyPct,
      mixed_types: mixed,
      whitespace_issues: whitespace,
      sample_distinct: values.size,
    });
    if (emptyPct >= 25) {
      issues.push(`Column "${name}": ~${emptyPct}% empty in sampled rows`);
    }
    if (mixed) {
      issues.push(`Column "${name}": mixed numbers and text`);
    }
    if (whitespace >= 3) {
      issues.push(`Column "${name}": leading/trailing spaces in ${whitespace} sampled cells`);
    }
  });

  const keyCol = 1;
  const keys: string[] = [];
  for (const row of sampleRows) {
    const k = cellTrimmed(model, sheetIndex, row, keyCol);
    if (k) keys.push(k.toLowerCase());
  }
  const dupKeys = keys.length - new Set(keys).size;
  if (dupKeys > 0) {
    issues.push(`Column "${headers[0]}": ~${dupKeys} duplicate key values in sample (possible dedupe needed)`);
  }

  return {
    sheet_index: sheetIndex,
    sheet_name: sheetName,
    column_count: headers.length,
    row_sample_count: sampleRows.length,
    columns,
    issues: issues.slice(0, 12),
  };
}

/** Lightweight profiling across all tabs for Ask AI data-cleaning guidance. */
export function scanWorkbookDataQuality(
  model: Model | null,
  sheetName: (sheet: number) => string,
): WorkbookQualitySnapshot | null {
  if (!model) return null;
  const props = model.getWorksheetsProperties();
  const sheets: SheetQualityProfile[] = [];
  const namesBySheet = new Map<string, Set<string>>();

  props.forEach((_, index) => {
    const profile = scanSheet(model, index, sheetName(index));
    if (!profile) return;
    sheets.push(profile);
    const set = new Set(profile.columns.map((c) => c.name.toLowerCase()));
    namesBySheet.set(profile.sheet_name, set);
  });

  if (!sheets.length) return null;

  const counts = new Map<string, number>();
  for (const set of namesBySheet.values()) {
    for (const n of set) {
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  const shared = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([n]) => n)
    .sort()
    .slice(0, 24);

  const notes: string[] = [];
  if (shared.length) {
    notes.push(
      `Shared column names across tabs (potential join keys): ${shared.slice(0, 10).join(', ')}`,
    );
  }
  const emptyHeavy = sheets
    .flatMap((s) => s.issues.filter((i) => i.includes('empty')))
    .slice(0, 4);
  if (emptyHeavy.length) {
    notes.push('Several tabs have sparse columns — align refresh SQL or drop unused fields before blending.');
  }

  return { sheets, cross_sheet: { shared_column_names: shared, notes } };
}
