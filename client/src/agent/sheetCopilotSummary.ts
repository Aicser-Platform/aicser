import type { SurfaceContext } from '@/agent/surfaceContext';

/** One-line context for the embedded sheet agent UI. */
export function sheetCopilotContextSummary(ctx: SurfaceContext): string | null {
  if (ctx.surface !== 'sheet') return null;
  const sheets = ctx.artifacts?.sheets ?? [];
  const tables = ctx.artifacts?.tables ?? [];
  const tabCount = sheets.length;
  const tableRows = tables.reduce((n, t) => n + (Number(t.row_count) || 0), 0);
  if (tables.length) {
    return `${tables.length} table${tables.length === 1 ? '' : 's'} in view · ~${tableRows.toLocaleString()} sample rows`;
  }
  if (tabCount) {
    return `${tabCount} sheet${tabCount === 1 ? '' : 's'} in this workbook`;
  }
  return null;
}
