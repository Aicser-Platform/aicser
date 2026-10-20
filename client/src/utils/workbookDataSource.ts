import type { DataSource } from '@/stores/useDataSourceStore';

/** Data source registered from Sheets → “Use in Ask” (workbook snapshot). */
export function workbookIdFromDataSource(ds: Pick<DataSource, 'connection_config'>): string | null {
  const cfg = ds.connection_config;
  if (!cfg || typeof cfg !== 'object') return null;
  const raw = (cfg as Record<string, unknown>).workbook_id;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id || null;
}

export function isWorkbookLinkedDataSource(ds: Pick<DataSource, 'connection_config'>): boolean {
  return workbookIdFromDataSource(ds) !== null;
}

function normalizeFileSourceName(name: string): string {
  const n = name.trim().toLowerCase();
  return n.endsWith(' (sheet)') ? n.slice(0, -8).trim() : n;
}

/** Count of extra active FILE rows that dedupe would deactivate (same project + normalized name). */
export function countDuplicateFileSources(sources: DataSource[]): number {
  const files = sources.filter((ds) => (ds.type || '').toLowerCase() === 'file' && ds.is_active !== false);
  const groups = new Map<string, number>();
  for (const ds of files) {
    const key = `${ds.project_id ?? ''}:${normalizeFileSourceName(ds.name || '')}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  let extra = 0;
  groups.forEach((n) => {
    if (n > 1) extra += n - 1;
  });
  return extra;
}
