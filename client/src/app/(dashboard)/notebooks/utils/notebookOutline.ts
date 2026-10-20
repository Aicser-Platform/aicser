import type { NotebookCell } from '@/services/notebookService';

export type OutlineItem = { id: string; cellId: string; title: string; level: number };

/** Markdown # headings in text cells — same idea as Jupyter/Kaggle table of contents. */
export function outlineFromCells(cells: NotebookCell[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const cell of cells) {
    if (cell.type !== 'markdown') continue;
    let n = 0;
    for (const line of cell.source.split('\n')) {
      const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const title = m[2].replace(/\s+#+\s*$/, '').trim();
      if (!title) continue;
      items.push({
        id: `${cell.id}:${n}`,
        cellId: cell.id,
        title,
        level: m[1].length,
      });
      n += 1;
    }
  }
  return items;
}

export function scrollToCell(cellId: string) {
  const el = document.querySelector(`[data-cell-id="${cellId}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
