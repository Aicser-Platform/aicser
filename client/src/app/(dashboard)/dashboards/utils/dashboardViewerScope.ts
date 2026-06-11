import type { DashboardPageItem } from '../components/DashboardPageTabs';
import type { LayoutItem, WidgetInstance } from '../stores/useDashboardStore';

/** Widgets visible on the active dashboard page. */
export function filterVisibleWidgets(
  widgets: WidgetInstance[],
  layout: LayoutItem[],
  activePageId: string | null,
  pages: DashboardPageItem[],
  defaultPageId: string | null,
): WidgetInstance[] {
  if (!activePageId) return widgets;

  if (pages.length === 0) {
    if (!layout.length) return widgets;
    const pageLayoutIds = new Set(
      layout.filter((l) => !l.pageId || l.pageId === activePageId).map((l) => l.i),
    );
    if (pageLayoutIds.size === 0) return widgets;
    return widgets.filter((w) => pageLayoutIds.has(w.id));
  }

  const defaultPage = defaultPageId || pages[0]?.id;
  const knownPageIds = new Set(pages.map((p) => String(p.id)));
  return widgets.filter((w) => {
    const li = layout.find((l) => l.i === w.id);
    // A pageId referencing a deleted/unknown page would hide the widget on
    // every tab — treat it as unassigned so it surfaces on the default page.
    const rawPid = li?.pageId;
    const pid = rawPid && knownPageIds.has(String(rawPid)) ? rawPid : undefined;
    return pid === activePageId || (!pid && activePageId === defaultPage);
  });
}

export function filterVisibleLayout(
  layout: LayoutItem[],
  visibleWidgets: WidgetInstance[],
): LayoutItem[] {
  return layout.filter((l) => visibleWidgets.some((w) => w.id === l.i));
}
