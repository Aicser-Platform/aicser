/** Display/save name for a query tab (matches tab title in UI). */
export function resolveQueryTabSaveName(title: string | undefined, fallbackIndex: number): string {
  const trimmed = (title || '').trim();
  if (trimmed) return trimmed;
  return `Query ${fallbackIndex}`;
}

export function isSameQueryName(a: string | undefined, b: string | undefined): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
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
