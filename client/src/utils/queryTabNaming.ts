/** Display/save name for a query tab (matches tab title in UI). */
export function resolveQueryTabSaveName(title: string | undefined, fallbackIndex: number): string {
  const trimmed = (title || '').trim();
  if (trimmed) return trimmed;
  return `Query ${fallbackIndex}`;
}

export function isSameQueryName(a: string | undefined, b: string | undefined): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/**
 * Pick a unique saved-query name. If `preferred` collides with another query
 * (and not `excludeId`), append " (2)", " (3)", … or a short timestamp.
 */
export function uniqueSavedQueryName(
  preferred: string,
  existing: Array<{ id?: number | string; name?: string }>,
  excludeId?: number | string | null,
): string {
  const base = (preferred || '').trim() || 'Query chart';
  const taken = (name: string) =>
    existing.some(
      (q) =>
        isSameQueryName(q.name, name) &&
        (excludeId == null || String(q.id) !== String(excludeId)),
    );
  if (!taken(base)) return base;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}

/** True when a saved-query row corresponds to the active editor tab. */
export function matchesActiveSavedQuery(
  record: { id?: unknown; name?: string },
  activeTab: { savedQueryId?: unknown; title?: string } | null | undefined,
): boolean {
  if (!activeTab) return false;
  if (
    record.id != null &&
    activeTab.savedQueryId != null &&
    String(record.id) === String(activeTab.savedQueryId)
  ) {
    return true;
  }
  return isSameQueryName(record.name, activeTab.title);
}

/** Snapshot name aligned with query tab title (no extra prefix/suffix). */
export function snapshotNameFromTabTitle(title: string | undefined, fallback: string): string {
  const trimmed = (title || '').trim();
  return trimmed || fallback;
}
