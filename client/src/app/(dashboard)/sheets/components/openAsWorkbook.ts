/**
 * "Open as workbook" from the SQL editor and notebooks: a new workbook whose first sheet holds
 * the result. A query result becomes a live range (re-run as the viewer when opened and on
 * refresh); a Python result becomes a snapshot handed over in this browser session.
 */
import { workbookService, type DataRange } from '@/services/workbookService';
import { newRangeId, seedKey } from './sheetData';

export type OpenAsWorkbook = {
  title: string;
  projectId?: string | null;
  columns: string[];
  rows: unknown[][];
  /** The query behind the result, when there is one. */
  live?: { dataSourceId: string; sql: string; sourceName?: string };
  rangeName?: string;
};

export async function openAsWorkbook(req: OpenAsWorkbook): Promise<string> {
  const range: DataRange = {
    id: newRangeId(), name: req.rangeName || req.title, sheet: 0, row: 1, column: 1, width: 0, height: 0,
    mode: req.live ? 'live' : 'snapshot', data_source_id: req.live?.dataSourceId ?? null,
    source_name: req.live?.sourceName ?? null, sql: req.live?.sql ?? null, pending: true,
  };
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* default */
  }
  const wb = await workbookService.create({ title: req.title.slice(0, 200), project_id: req.projectId ?? null, timezone, ranges: [range] });
  if (!req.live) {
    try {
      window.sessionStorage.setItem(seedKey(wb.id, range.id), JSON.stringify({ columns: req.columns, rows: req.rows }));
    } catch {
      /* too large for session storage: the range opens empty and says so */
    }
  }
  return wb.id;
}
