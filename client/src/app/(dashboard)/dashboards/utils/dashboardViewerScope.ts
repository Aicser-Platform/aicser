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
  return widgets.filter((w) => {
    const li = layout.find((l) => l.i === w.id);
    const pid = li?.pageId;
    return pid === activePageId || (!pid && activePageId === defaultPage);
  });
}

export function filterVisibleLayout(
  layout: LayoutItem[],
  visibleWidgets: WidgetInstance[],
): LayoutItem[] {
  return layout.filter((l) => visibleWidgets.some((w) => w.id === l.i));
}
