'use client';

/**
 * How big a KPI's number is, from the card it sits in — the same rule in chat, the Chart Designer,
 * dashboards and shared views. The number takes a share of the card's height, never more than fits the
 * formatted value across its width, within a readable range; the label follows at about a third.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const KPI_VALUE_MIN = 28;
export const KPI_VALUE_MAX = 96;
/** Below this the number would be harder to read than the label; only very narrow cards go under it. */
const KPI_VALUE_FLOOR = 16;
/** Average glyph width of a bold number as a share of its font size (digits, separators, units). */
const GLYPH_WIDTH = 0.6;

export function kpiValueSize(
  width: number,
  height: number,
  characters: number,
  heightShare = 0.42,
  max = KPI_VALUE_MAX,
): number {
  const byHeight = height > 0 ? height * heightShare : Number.POSITIVE_INFINITY;
  const byWidth = width > 0 ? (width * 0.86) / (Math.max(4, characters) * GLYPH_WIDTH) : Number.POSITIVE_INFINITY;
  const raw = Math.min(byHeight, byWidth, max);
  if (!Number.isFinite(raw)) return 32;
  // A narrow card may go below the usual minimum rather than cut the number.
  const floor = byWidth < KPI_VALUE_MIN ? Math.max(KPI_VALUE_FLOOR, byWidth) : KPI_VALUE_MIN;
  return Math.round(Math.max(floor, raw));
}

export function kpiLabelSize(valuePx: number): number {
  return Math.round(Math.min(16, Math.max(11, valuePx * 0.3)));
}

/** Measures the card (ResizeObserver) and returns the number's size for it. The ref is a callback,
 * so the card is measured whenever its element appears — a KPI often renders a loading state first,
 * and a mount-only effect would never see the real card. */
export function useKpiValueSize(characters: number, heightShare = 0.42, max = KPI_VALUE_MAX) {
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => setBox((prev) => (
      prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }
    ));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, valuePx: kpiValueSize(box.width, box.height, characters, heightShare, max) };
}
