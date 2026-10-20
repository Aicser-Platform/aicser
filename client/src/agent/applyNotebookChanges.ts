import { newCellId, nextResultName, type NotebookCell } from '@/services/notebookService';
import type { SurfaceNotebookChanges } from '@/agent/surfaceAgentTypes';

/**
 * The notebook after a reviewed change set (edits, deletes, then new cells in place), and the
 * ids of the cells to run afterwards in notebook order. Pure: the editor keeps the previous
 * list for Undo.
 */
export function notebookWithChanges(
  cells: NotebookCell[],
  action: SurfaceNotebookChanges,
  newId: () => string = newCellId,
): { cells: NotebookCell[]; run: string[]; applied: number } {
  let applied = 0;
  const edits = new Map((action.edit ?? []).map((e) => [e.cell_id, e.source]));
  const deletes = new Set(action.delete ?? []);
  let next: NotebookCell[] = [];
  for (const c of cells) {
    if (deletes.has(c.id)) {
      applied += 1;
      continue;
    }
    if (edits.has(c.id)) {
      // New source, so the old result no longer describes it.
      next.push({ ...c, source: edits.get(c.id) ?? c.source, output: null });
      applied += 1;
    } else {
      next.push(c);
    }
  }

  const idByName = new Map<string, string>();
  for (const a of action.add ?? []) {
    const name = a.cell_type === 'markdown'
      ? null
      : next.some((c) => c.name === a.name) ? nextResultName(next, a.cell_type === 'sql' ? 'q' : 'df') : a.name;
    const cell: NotebookCell = {
      id: newId(),
      type: a.cell_type,
      source: a.source,
      name,
      data_source_id: a.cell_type === 'sql' ? a.data_source_id : null,
      chart: null,
    };
    if (name) idByName.set(a.name, cell.id);
    const at = a.after_cell_id ? next.findIndex((c) => c.id === a.after_cell_id) : -1;
    next = at >= 0 ? [...next.slice(0, at + 1), cell, ...next.slice(at + 1)] : [...next, cell];
    applied += 1;
  }

  const wanted = new Set((action.run ?? []).map((r) => idByName.get(r) ?? r));
  const run = next.filter((c) => wanted.has(c.id) && (c.type === 'sql' || c.type === 'python')).map((c) => c.id);
  return { cells: next, run, applied };
}
