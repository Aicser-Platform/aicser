/** Server `surface_actions`: change sets the notebook / workbook assistant proposes (planned by
 * the model, checked on the server against the open artifact and its data, applied here as
 * one undoable step after the person reviews them). */

export type NotebookCellAdd = {
  /** Insert after this existing cell; null = at the end. */
  after_cell_id: string | null;
  cell_type: 'sql' | 'python' | 'markdown';
  name: string;
  source: string;
  data_source_id: string | null;
};

export type SurfaceNotebookChanges = {
  type: 'notebook_changes';
  add?: NotebookCellAdd[];
  edit?: Array<{ cell_id: string; source: string }>;
  delete?: string[];
  /** Existing cell ids, or the names of cells added above. */
  run?: string[];
  notes?: string[];
};

export type SheetWrite = { sheet: string; cell: string; formula?: string; value?: string | number | boolean };

export type SurfaceSheetChanges = {
  type: 'sheet_changes';
  sheets?: Array<{ name: string }>;
  ranges?: Array<{ name: string; sql: string; data_source_id: string; sheet: string; anchor: string }>;
  writes?: SheetWrite[];
  charts?: Array<{ sheet: string; range: string; chart_type: string; title: string }>;
  notes?: string[];
};

export type SurfaceAgentAction = SurfaceNotebookChanges | SurfaceSheetChanges;

/** What applying returns: a way to put the artifact back as it was. */
export type SurfaceUndo = () => void | Promise<void>;

const KNOWN = new Set(['notebook_changes', 'sheet_changes']);

export function parseSurfaceActions(raw: unknown): SurfaceAgentAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a) => a && typeof a === 'object' && KNOWN.has(String((a as { type?: string }).type)),
  ) as SurfaceAgentAction[];
}

/** One line per change, for the review card. */
export function describeSurfaceChanges(
  action: SurfaceAgentAction,
  t: (key: string, values?: Record<string, string | number>) => string,
  cellLabel: (id: string) => string = (id) => id,
): Array<{ key: string; text: string; detail?: string }> {
  const out: Array<{ key: string; text: string; detail?: string }> = [];
  if (action.type === 'notebook_changes') {
    for (const [i, a] of (action.add ?? []).entries()) {
      out.push({
        key: `add-${i}`,
        text: a.after_cell_id
          ? t('change_add_cell_after', { type: a.cell_type.toUpperCase(), name: a.name, after: cellLabel(a.after_cell_id) })
          : t('change_add_cell', { type: a.cell_type.toUpperCase(), name: a.name }),
        detail: a.source,
      });
    }
    for (const e of action.edit ?? []) out.push({ key: `edit-${e.cell_id}`, text: t('change_edit_cell', { name: cellLabel(e.cell_id) }), detail: e.source });
    for (const d of action.delete ?? []) out.push({ key: `del-${d}`, text: t('change_delete_cell', { name: cellLabel(d) }) });
    if (action.run?.length) out.push({ key: 'run', text: t('change_run_cells', { names: action.run.map(cellLabel).join(', ') }) });
  } else {
    for (const s of action.sheets ?? []) out.push({ key: `sheet-${s.name}`, text: t('change_add_sheet', { name: s.name }) });
    for (const r of action.ranges ?? []) {
      out.push({ key: `range-${r.name}`, text: t('change_live_range', { name: r.name, at: `${r.sheet}!${r.anchor}` }), detail: r.sql });
    }
    const writes = action.writes ?? [];
    if (writes.length) {
      const formulas = writes.filter((w) => w.formula).length;
      const bySheet = Array.from(new Set(writes.map((w) => w.sheet))).join(', ');
      out.push({
        key: 'writes',
        text: t('change_writes', { count: writes.length, formulas, sheets: bySheet }),
        detail: writes.slice(0, 40).map((w) => `${w.sheet}!${w.cell}  ${w.formula ?? String(w.value)}`).join('\n'),
      });
    }
    for (const [i, c] of (action.charts ?? []).entries()) {
      out.push({ key: `chart-${i}`, text: t('change_chart', { type: c.chart_type, title: c.title || c.range, at: `${c.sheet}!${c.range}` }) });
    }
  }
  return out;
}
