/** sessionStorage payload when opening /query-editor from chat chart inspect menu. */
export const QUERY_EDITOR_IMPORT_SESSION_KEY = 'aicser_query_editor_import';

export type QueryEditorImportPayload = {
  sql: string;
  dataSourceId?: string;
  title?: string;
  rows?: Record<string, unknown>[];
  fromChatMessageId?: string;
  stagedAt?: number;
};

export function stageQueryEditorImport(payload: Omit<QueryEditorImportPayload, 'stagedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      QUERY_EDITOR_IMPORT_SESSION_KEY,
      JSON.stringify({ ...payload, stagedAt: Date.now() }),
    );
  } catch {
    /* ignore quota errors */
  }
}

function parseStagedImport(raw: string | null, maxAgeMs: number): QueryEditorImportPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as QueryEditorImportPayload;
    if (!parsed?.sql?.trim()) return null;
    if (parsed.stagedAt && Date.now() - parsed.stagedAt > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read staged import without removing (safe for hydration guards). */
export function peekQueryEditorImport(maxAgeMs = 5 * 60 * 1000): QueryEditorImportPayload | null {
  if (typeof window === 'undefined') return null;
  return parseStagedImport(sessionStorage.getItem(QUERY_EDITOR_IMPORT_SESSION_KEY), maxAgeMs);
}

export function clearQueryEditorImport(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(QUERY_EDITOR_IMPORT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function consumeQueryEditorImport(maxAgeMs = 5 * 60 * 1000): QueryEditorImportPayload | null {
  const parsed = peekQueryEditorImport(maxAgeMs);
  if (parsed) clearQueryEditorImport();
  return parsed;
}

export function buildQueryEditorImportPath(fromChatMessageId?: string): string {
  const q = new URLSearchParams({ import: '1' });
  if (fromChatMessageId) q.set('from_chat', fromChatMessageId);
  return `/query-editor?${q.toString()}`;
}

export const QUERY_EDITOR_IMPORT_EVENT = 'query-editor-import';

export function dispatchQueryEditorImport(payload: QueryEditorImportPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUERY_EDITOR_IMPORT_EVENT, { detail: payload }));
}

export function hasQueryEditorImportPending(): boolean {
  return peekQueryEditorImport() != null;
}
