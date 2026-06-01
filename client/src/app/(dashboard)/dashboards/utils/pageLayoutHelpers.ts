import type { LayoutItem } from '../stores/useDashboardStore';

/** Whether a layout item belongs to the given page (unassigned items belong to default page). */
export function layoutBelongsToPage(
  item: LayoutItem,
  pageId: string | null,
  defaultPageId: string | null
): boolean {
  if (!pageId) return true;
  const pid = item.pageId;
  if (pid === pageId) return true;
  if (!pid && defaultPageId && pageId === defaultPageId) return true;
  return false;
}

/** Merge updated page layout into full dashboard layout. */
export function mergePageLayout(
  fullLayout: LayoutItem[],
  pageLayoutUpdate: LayoutItem[],
  pageId: string | null,
  defaultPageId: string | null
): LayoutItem[] {
  const updatedIds = new Set(pageLayoutUpdate.map((l) => l.i));
  const otherPagesLayout = fullLayout.filter(
    (l) => !updatedIds.has(l.i) && !layoutBelongsToPage(l, pageId, defaultPageId)
  );
  const mergedPageLayout = pageLayoutUpdate.map((l) => ({
    ...l,
    ...(pageId ? { pageId } : {}),
  }));
  return [...otherPagesLayout, ...mergedPageLayout];
}
