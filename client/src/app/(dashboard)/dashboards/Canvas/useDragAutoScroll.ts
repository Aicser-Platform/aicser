import { useCallback, useEffect, useMemo, useRef } from 'react';

/** Distance from the scroll area's top/bottom edge (px) where dragging starts to scroll. */
const EDGE = 72;
/** Fastest scroll speed (px per frame), reached right at the edge. */
const MAX_STEP = 22;

function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * While a widget is dragged or resized, scroll the page when the pointer nears the top or
 * bottom edge — so a widget can be taken below (or above) what's on screen, as in Figma or
 * Google Sheets. The grid follows because the drag is re-fed the pointer after each scroll.
 */
export function useDragAutoScroll(gridRef: React.RefObject<HTMLElement | null>) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const active = useRef(false);

  const tick = useCallback(() => {
    frame.current = null;
    if (!active.current || !pointer.current) return;
    const scroller = scrollParent(gridRef.current);
    const isRoot = scroller === document.scrollingElement || scroller === document.documentElement;
    const top = isRoot ? 0 : scroller.getBoundingClientRect().top;
    const bottom = isRoot ? window.innerHeight : scroller.getBoundingClientRect().bottom;
    const { x, y } = pointer.current;
    let step = 0;
    if (y > bottom - EDGE) step = Math.ceil(MAX_STEP * Math.min(1, (y - (bottom - EDGE)) / EDGE));
    else if (y < top + EDGE) step = -Math.ceil(MAX_STEP * Math.min(1, (top + EDGE - y) / EDGE));
    if (step !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      if (scroller.scrollTop !== before) {
        // The pointer didn't move but the page did: tell the drag, so the widget keeps up.
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      }
    }
    frame.current = requestAnimationFrame(tick);
  }, [gridRef]);

  const onMove = useCallback((e: MouseEvent | TouchEvent) => {
    const p = 'touches' in e ? e.touches[0] : e;
    if (p && e.isTrusted) pointer.current = { x: p.clientX, y: p.clientY };
  }, []);

  const start = useCallback(() => {
    active.current = true;
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    if (frame.current == null) frame.current = requestAnimationFrame(tick);
  }, [onMove, tick]);

  const stop = useCallback(() => {
    active.current = false;
    pointer.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, [onMove]);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ start, stop }), [start, stop]);
}
