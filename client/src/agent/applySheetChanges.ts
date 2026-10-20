import type { Model } from '@ironcalc/workbook';
import type { WorkbookVisualEmbed } from '@/services/workbookService';
import { extractTableBox } from '@/app/(dashboard)/sheets/components/sheetTableExtract';
import { newVisualEmbedId } from '@/app/(dashboard)/sheets/components/sheetVisualEmbed';
import type { SurfaceSheetChanges } from '@/agent/surfaceAgentTypes';

/** "B12" → { row: 12, column: 2 } (1-based, as IronCalc counts). */
export function parseA1(ref: string): { row: number; column: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let column = 0;
  for (const ch of m[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), column };
}

export type SheetChangeContext = {
  model: Model;
  /** Puts a live SQL range at a cell (the editor's own insert, with its overwrite check). */
  insertRangeAt: (
    req: { dataSourceId: string; sourceName: string; sql: string; name: string },
    at: { sheet: number; row: number; column: number },
  ) => Promise<void>;
  sourceName: (dataSourceId: string) => string;
  visualEmbeds: WorkbookVisualEmbed[];
  persistVisualEmbeds: (next: WorkbookVisualEmbed[]) => Promise<void>;
};

const sheetIndex = (model: Model, name: string): number => {
  const i = model.getWorksheetsProperties().findIndex((s) => s.name === name);
  return i;
};

/**
 * Applies a reviewed change set: new tabs first, then live ranges, cell writes and charts (a chart
 * reads its numbers from the cells it names, after the writes). Returns how many changes landed.
 */
export async function applySheetChanges(action: SurfaceSheetChanges, ctx: SheetChangeContext): Promise<number> {
  const { model } = ctx;
  let applied = 0;

  for (const s of action.sheets ?? []) {
    if (sheetIndex(model, s.name) >= 0) continue;
    model.newSheet();
    const created = model.getWorksheetsProperties().length - 1;
    model.renameSheet(created, s.name);
    applied += 1;
  }

  for (const r of action.ranges ?? []) {
    const sheet = sheetIndex(model, r.sheet);
    const at = parseA1(r.anchor);
    if (sheet < 0 || !at) continue;
    await ctx.insertRangeAt(
      { dataSourceId: r.data_source_id, sourceName: ctx.sourceName(r.data_source_id), sql: r.sql, name: r.name },
      { sheet, ...at },
    );
    applied += 1;
  }

  for (const w of action.writes ?? []) {
    const sheet = sheetIndex(model, w.sheet);
    const at = parseA1(w.cell);
    if (sheet < 0 || !at) continue;
    const input = w.formula ?? (typeof w.value === 'string' ? w.value : String(w.value ?? ''));
    model.setUserInput(sheet, at.row, at.column, input);
    applied += 1;
  }

  const embeds: WorkbookVisualEmbed[] = [];
  for (const c of action.charts ?? []) {
    const sheet = sheetIndex(model, c.sheet);
    const [from, to] = c.range.split(':').map(parseA1);
    if (sheet < 0 || !from || !to) continue;
    model.evaluate?.();
    const table = extractTableBox(model, sheet, from.row, from.column, to.row, to.column, `${c.sheet}!${c.range}`);
    if (!table || table.columns.length < 2) continue;
    const num = (v: unknown) => (typeof v === 'number' ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
    embeds.push({
      id: newVisualEmbedId(),
      kind: 'chart',
      sheet_index: sheet,
      row: from.row,
      column: to.column + 2,
      width: 440,
      height: 280,
      payload: {
        chartType: c.chart_type,
        title: c.title || table.name,
        chartData: {
          x: table.rows.map((r) => String(r[0] ?? '')),
          series: table.columns.slice(1).map((name, i) => ({ name, data: table.rows.map((r) => num(r[i + 1])) })),
        },
      },
    });
    applied += 1;
  }
  if (embeds.length) await ctx.persistVisualEmbeds([...ctx.visualEmbeds, ...embeds]);
  return applied;
}
