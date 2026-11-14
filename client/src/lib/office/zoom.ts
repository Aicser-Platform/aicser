export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** A zoom level within 50–200%, in 5% steps (floating sums like 1.1 + 0.1 stay exact). */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 20) / 20));
}
