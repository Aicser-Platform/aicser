/**
 * Live notebook editor state → ACC artifacts (complements server hydration from DB).
 */

import type { SurfaceContext } from '@/agent/surfaceContext';
import { buildNotebookSurfaceContext } from '@/agent/surfaceContext';
import { withSurfaceDataConnectivity } from '@/agent/surfaceDataConnectivity';
import type { NotebookCell } from '@/services/notebookService';
import type { ResultInfo } from '@/app/(dashboard)/notebooks/components/NotebookCell';

const MAX_SOURCE_PREVIEW = 480;
const MAX_SQL_FOR_SERVER = 6000;

function truncateSource(source: string, max = MAX_SOURCE_PREVIEW): string {
  const s = source.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function summarizeNotebookCells(
  cells: NotebookCell[],
  resultInfos?: ResultInfo[],
  opts?: { selectedCellId?: string },
): Array<Record<string, unknown>> {
  const framesByName = new Map((resultInfos ?? []).map((r) => [r.name, r]));
  return cells.map((c, index) => {
    const frame = c.name ? framesByName.get(c.name) : undefined;
    const out = c.output;
    const rowCount =
      frame?.rows ??
      (out && typeof out === 'object' && 'row_count' in out
        ? (out as { row_count?: number }).row_count
        : undefined);
    const chart = c.chart;
    const sqlSource = c.type === 'sql' && c.source?.trim() ? c.source.trim() : '';
    return {
      index,
      id: c.id,
      cell_type: c.type,
      name: c.name ?? undefined,
      data_source_id: c.data_source_id ?? undefined,
      sql:
        sqlSource.length > MAX_SQL_FOR_SERVER
          ? `${sqlSource.slice(0, MAX_SQL_FOR_SERVER)}…`
          : sqlSource || undefined,
      source_preview: c.source?.trim() ? truncateSource(c.source) : undefined,
      source_chars: c.source?.length ?? 0,
      chart_type: chart?.type,
      // A pivot is a cell type; its rows and columns live on the cell's chart spec.
      pivot_rows: c.type === 'pivot' ? chart?.rows : undefined,
      pivot_columns: c.type === 'pivot' ? chart?.columns : undefined,
      output_row_count: rowCount,
      output_columns: frame?.columns?.slice(0, 16),
      selected: opts?.selectedCellId === c.id,
      collapsed: c.collapsed ?? false,
    };
  });
}

export function buildNotebookStudioSurfaceContext(opts: {
  notebookId: string;
  title?: string;
  intent?: SurfaceContext['intent'];
  cells: NotebookCell[];
  resultInfos?: ResultInfo[];
  selectedCellId?: string;
  dataSourceId?: string;
}): SurfaceContext {
  const base = buildNotebookSurfaceContext({
    notebookId: opts.notebookId,
    title: opts.title,
    intent: opts.intent,
    dataSourceId: opts.dataSourceId,
  });
  const summarized = summarizeNotebookCells(opts.cells, opts.resultInfos, {
    selectedCellId: opts.selectedCellId,
  });
  const frames = (opts.resultInfos ?? []).map((r) => ({
    name: r.name,
    columns: r.columns,
    row_count: r.rows,
  }));
  return withSurfaceDataConnectivity({
    ...base,
    selection: opts.selectedCellId ? { cell_id: opts.selectedCellId } : undefined,
    artifacts: {
      cells: summarized,
      frames,
    },
  });
}
