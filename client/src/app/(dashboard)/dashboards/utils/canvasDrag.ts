import type React from 'react';

/** What is being dragged onto a dashboard canvas: a new block, or a saved chart from the library. */
export type CanvasDragItem =
  | { kind: 'block'; type: string; w: number; h: number }
  | { kind: 'chart'; chartId: string; title: string; chartType: string; w: number; h: number };

export const CANVAS_DRAG_MIME = 'application/x-aicser-widget';

// The browser hides drag data until drop; the grid needs the item's size while hovering to
// draw the placeholder where it will land, so the item is also kept here for the drag.
let current: CanvasDragItem | null = null;

export function startCanvasDrag(e: React.DragEvent, item: CanvasDragItem): void {
  current = item;
  e.dataTransfer.setData(CANVAS_DRAG_MIME, JSON.stringify(item));
  e.dataTransfer.setData('text/plain', item.kind === 'chart' ? item.title : item.type);
  e.dataTransfer.effectAllowed = 'copy';
}

export function endCanvasDrag(): void {
  current = null;
}

export function currentCanvasDrag(): CanvasDragItem | null {
  return current;
}

/** The dragged item at drop time (from the drag, or the event's data as a fallback). */
export function droppedCanvasItem(e: Event | React.DragEvent): CanvasDragItem | null {
  if (current) return current;
  const raw = (e as DragEvent).dataTransfer?.getData(CANVAS_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CanvasDragItem;
  } catch {
    return null;
  }
}
