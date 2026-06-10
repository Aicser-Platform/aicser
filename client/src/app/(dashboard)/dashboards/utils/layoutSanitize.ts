import type { LayoutItem } from '../stores/useDashboardStore';

/** Coerce react-grid-layout values (Infinity → bottom row) for API persistence. */
export function sanitizeLayoutItem(
  item: Partial<LayoutItem>,
  fallbackY = 0
): { x: number; y: number; w: number; h: number; page_id?: string } {
  const x = Number.isFinite(Number(item.x)) ? Math.max(0, Math.round(Number(item.x))) : 0;
  const w = Number.isFinite(Number(item.w)) && Number(item.w) > 0 ? Math.round(Number(item.w)) : 6;
  let y = Number(item.y);
  if (!Number.isFinite(y) || y === Infinity || y === -Infinity) {
    y = fallbackY;
  } else {
    y = Math.max(0, Math.round(y));
  }
  const h = Number.isFinite(Number(item.h)) && Number(item.h) > 0 ? Math.round(Number(item.h)) : 5;
  const out: { x: number; y: number; w: number; h: number; page_id?: string } = { x, y, w, h };
  if (item.pageId) out.page_id = String(item.pageId);
  return out;
}

export function maxLayoutY(layout: LayoutItem[]): number {
  return layout.reduce((max, l) => {
    const y = Number(l.y);
    const h = Number(l.h) || 5;
    if (!Number.isFinite(y)) return max;
    return Math.max(max, y + h);
  }, 0);
}
