import type { SheetAnalyzeRestore } from './SheetAnalyzePanel';

export type WorkbookAnalyzeBinding = {
  id: string;
  kind: 'pivot';
  sheet_index: number;
  row: number;
  column: number;
  width: number;
  height: number;
  analyze_binding: SheetAnalyzeRestore;
};

export function newAnalyzeBindingId(): string {
  return `ab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function findAnalyzeBindingAt(
  bindings: WorkbookAnalyzeBinding[],
  sheet: number,
  row: number,
  column: number,
): WorkbookAnalyzeBinding | null {
  for (const b of bindings) {
    if (b.sheet_index !== sheet) continue;
    const r1 = b.row;
    const c1 = b.column;
    const r2 = b.row + Math.max(b.height, 1) - 1;
    const c2 = b.column + Math.max(b.width, 1) - 1;
    if (row >= r1 && row <= r2 && column >= c1 && column <= c2) return b;
  }
  return null;
}
