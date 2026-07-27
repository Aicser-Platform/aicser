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

export function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function hasLayoutOverlaps(
  layout: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      const a = layout[i];
      const b = layout[j];
      if (a && b && rectsOverlap(a, b)) return true;
    }
  }
  return false;
}

function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

/** Place a widget at preferred grid coords, or the nearest free slot (no auto-pack to top). */
export function findFreeLayoutPosition(
  layout: Array<{ x: number; y: number; w: number; h: number; i?: string }>,
  preferred: { x: number; y: number; w: number; h: number },
  cols = 12,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, Math.min(cols, Math.round(preferred.w) || 6));
  const h = Math.max(1, Math.round(preferred.h) || 5);
  const maxX = Math.max(0, cols - w);
  const startX = Math.max(0, Math.min(maxX, Math.round(preferred.x) || 0));
  const startY = Math.max(0, Math.round(preferred.y) || 0);

  const collides = (x: number, y: number) =>
    layout.some((item) => rectsOverlap({ x, y, w, h }, item));

  if (!collides(startX, startY)) {
    return { x: startX, y: startY, w, h };
  }

  // Spiral / nearest-cell search — prefer staying near the drop, not dumping to the bottom.
  const maxRadius = Math.max(24, maxLayoutY(layout as LayoutItem[]) + h + 4);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const px = Math.max(0, Math.min(maxX, startX + dx));
        const py = Math.max(0, startY + dy);
        if (!collides(px, py)) return { x: px, y: py, w, h };
      }
    }
  }

  return { x: startX, y: maxLayoutY(layout as LayoutItem[]), w, h };
}

/**
 * Single placement path for Chat pin / Query Visualize / Designer / canvas link.
 * Prefers preferred coords when free; otherwise nearest free slot (never stacks on neighbors).
 */
export function placePinnedLayoutItem(
  existing: Array<{ x: number; y: number; w: number; h: number; i?: string; pageId?: string }>,
  preferred: Partial<{ x: number; y: number; w: number; h: number; pageId?: string }> = {},
  cols = 12,
): { x: number; y: number; w: number; h: number; page_id?: string } {
  const w = preferred.w ?? 6;
  const h = preferred.h ?? 5;
  const pageScoped = preferred.pageId
    ? existing.filter((item) => String(item.pageId || '') === String(preferred.pageId))
    : existing.filter((item) => !item.pageId);
  const free = findFreeLayoutPosition(
    pageScoped,
    {
      x: preferred.x ?? 0,
      // Default below existing content so new pins don't fight top-left neighbors
      y: preferred.y ?? maxLayoutY(pageScoped as LayoutItem[]),
      w,
      h,
    },
    cols,
  );
  return sanitizeLayoutItem({ ...free, pageId: preferred.pageId });
}

export type GridRect = { i?: string; x: number; y: number; w: number; h: number };

type ResolveOpts = {
  movedId?: string | null;
  cols?: number;
  /** Pre-gesture rect of the moved/resized item. */
  before?: GridRect | null;
};

function normalizeItems<T extends GridRect>(layout: T[], cols: number): T[] {
  const items: T[] = layout.map((item) => ({
    ...item,
    x: Math.max(0, Math.round(Number(item.x) || 0)),
    y: Math.max(0, Math.round(Number(item.y) || 0)),
    w: Math.max(1, Math.min(cols, Math.round(Number(item.w) || 1))),
    h: Math.max(1, Math.round(Number(item.h) || 1)),
  }));
  for (const item of items) {
    item.x = Math.max(0, Math.min(cols - item.w, item.x));
  }
  return items;
}

function isResize(before: GridRect, moved: GridRect): boolean {
  return before.w !== moved.w || before.h !== moved.h;
}

function centerOf(r: GridRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** True when the drop looks like “replace this tile” — swap, don’t shove. */
function shouldSwap(moved: GridRect, other: GridRect, before: GridRect): boolean {
  if (isResize(before, moved)) return false;

  const area = overlapArea(moved, other);
  const smaller = Math.min(moved.w * moved.h, other.w * other.h);
  if (smaller <= 0) return false;

  // Strong coverage of the target, or drop center lands inside the neighbor.
  const coverage = area / smaller;
  const c = centerOf(moved);
  const centerInside =
    c.x >= other.x && c.x < other.x + other.w && c.y >= other.y && c.y < other.y + other.h;

  if (coverage < 0.35 && !centerInside) return false;

  // Swap works best when sizes are comparable (KPI↔KPI, chart↔chart).
  const wRatio = Math.max(moved.w, other.w) / Math.max(1, Math.min(moved.w, other.w));
  const hRatio = Math.max(moved.h, other.h) / Math.max(1, Math.min(moved.h, other.h));
  return wRatio <= 2.2 && hRatio <= 2.2;
}

/**
 * Smallest edge nudge that clears `anchor`. Prefers the approach direction
 * (resize growth / drag vector) and heavily penalizes large downward dumps.
 */
function minimalClearance(
  anchor: GridRect,
  sliding: GridRect,
  cols: number,
  bias: { preferRight?: boolean; preferDown?: boolean; preferLeft?: boolean; preferUp?: boolean },
): { x: number; y: number } | null {
  const leftPush = sliding.x + sliding.w - anchor.x; // move sliding left
  const rightPush = anchor.x + anchor.w - sliding.x; // move sliding right
  const upPush = sliding.y + sliding.h - anchor.y;
  const downPush = anchor.y + anchor.h - sliding.y;

  type Cand = { x: number; y: number; cost: number };
  const cands: Cand[] = [];

  if (leftPush > 0) {
    const x = sliding.x - leftPush;
    if (x >= 0) {
      let cost = leftPush * 10;
      if (bias.preferLeft) cost -= 40;
      if (bias.preferRight) cost += 20;
      cands.push({ x, y: sliding.y, cost });
    }
  }
  if (rightPush > 0) {
    const x = sliding.x + rightPush;
    if (x + sliding.w <= cols) {
      let cost = rightPush * 10;
      if (bias.preferRight) cost -= 40;
      if (bias.preferLeft) cost += 20;
      cands.push({ x, y: sliding.y, cost });
    }
  }
  if (upPush > 0) {
    const y = sliding.y - upPush;
    if (y >= 0) {
      let cost = upPush * 10;
      if (bias.preferUp) cost -= 40;
      if (bias.preferDown) cost += 20;
      // Slight preference for vertical-up over dumping down when equal.
      cost -= 1;
      cands.push({ x: sliding.x, y, cost });
    }
  }
  if (downPush > 0) {
    const y = sliding.y + downPush;
    let cost = downPush * 10;
    if (bias.preferDown) cost -= 40;
    if (bias.preferUp) cost += 20;
    // Soft penalty so down isn't the default when left/right clear just as cheaply.
    cost += 8;
    cands.push({ x: sliding.x, y, cost });
  }

  cands.sort((a, b) => a.cost - b.cost);
  for (const c of cands) {
    const trial = { ...sliding, x: c.x, y: c.y };
    if (!rectsOverlap(anchor, trial)) return { x: c.x, y: c.y };
  }
  return null;
}

function growthBias(before: GridRect | null | undefined, moved: GridRect | null): {
  preferRight?: boolean;
  preferDown?: boolean;
  preferLeft?: boolean;
  preferUp?: boolean;
} {
  if (!before || !moved) return {};
  if (moved.w > before.w && moved.x < before.x) return { preferLeft: true };
  if (moved.w > before.w && moved.x <= before.x) return { preferRight: true };
  if (moved.h > before.h && moved.y < before.y) return { preferUp: true };
  if (moved.h > before.h && moved.y <= before.y) return { preferDown: true };
  // Drag vector: prefer pushing the neighbor along the drag direction.
  if (!isResize(before, moved)) {
    const dx = moved.x - before.x;
    const dy = moved.y - before.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? { preferRight: true } : { preferLeft: true };
    }
    return dy >= 0 ? { preferDown: true } : { preferUp: true };
  }
  return {};
}

function trySwapMovedOntoNeighbor<T extends GridRect>(
  items: T[],
  moved: T,
  before: GridRect,
  cols: number,
): boolean {
  const others = items.filter((item) => item !== moved && rectsOverlap(moved, item));
  if (others.length !== 1) return false;
  const other = others[0]!;
  if (!shouldSwap(moved, other, before)) return false;

  const destX = Math.max(0, Math.min(cols - other.w, before.x));
  const destY = Math.max(0, before.y);
  const trialOther = { ...other, x: destX, y: destY };

  // Accept swap if the neighbor can sit at the mover's old slot without hitting
  // anyone except the mover (who now occupies the drop cell).
  const hitsForeign = items.some(
    (item) => item !== moved && item !== other && rectsOverlap(trialOther, item),
  );
  if (hitsForeign) return false;

  other.x = destX;
  other.y = destY;
  return true;
}

/**
 * Resolve overlaps with minimal disruption:
 * 1) Prefer swap when dropping onto a comparable neighbor
 * 2) Else nudge the collided neighbor by the smallest edge clearance
 * 3) Safety: nearest free cell (not “always dump below”)
 */
export function resolveLayoutCollisions<T extends GridRect>(
  layout: T[],
  opts: ResolveOpts = {},
): T[] {
  const cols = opts.cols ?? 12;
  const items = normalizeItems(layout, cols);
  if (items.length < 2) return items;

  const movedId = opts.movedId != null ? String(opts.movedId) : null;
  const before = opts.before ?? null;
  const moved = movedId ? items.find((item) => String(item.i) === movedId) ?? null : null;
  const bias = growthBias(before, moved);

  // ── Phase 1: swap when the gesture is a drop onto another tile ───────────
  if (moved && before && !isResize(before, moved)) {
    trySwapMovedOntoNeighbor(items, moved, before, cols);
  }

  // ── Phase 2: minimal edge nudges (keep mover anchored when known) ────────
  let guard = 0;
  while (hasLayoutOverlaps(items) && guard < 160) {
    guard += 1;
    let progressed = false;

    // Resolve collisions involving the moved item first so neighbors yield to it.
    const pairs: Array<[T, T]> = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i]!;
        const b = items[j]!;
        if (rectsOverlap(a, b)) pairs.push([a, b]);
      }
    }

    pairs.sort((pairA, pairB) => {
      const score = (pair: [T, T]) =>
        movedId
          ? Number(String(pair[0].i) === movedId || String(pair[1].i) === movedId)
          : 0;
      return score(pairB) - score(pairA);
    });

    for (const [a, b] of pairs) {
      if (!rectsOverlap(a, b)) continue;

      const aMoved = movedId != null && String(a.i) === movedId;
      const bMoved = movedId != null && String(b.i) === movedId;

      let anchor = a;
      let sliding = b;
      if (aMoved && !bMoved) {
        anchor = a;
        sliding = b;
      } else if (bMoved && !aMoved) {
        anchor = b;
        sliding = a;
      } else {
        // Neither is the active mover: nudge the one that moved farther from origin
        // less… keep the higher/left item as soft anchor to stay stable.
        if (a.y < b.y || (a.y === b.y && a.x <= b.x)) {
          anchor = a;
          sliding = b;
        } else {
          anchor = b;
          sliding = a;
        }
      }

      const next = minimalClearance(anchor, sliding, cols, bias);
      if (next && (next.x !== sliding.x || next.y !== sliding.y)) {
        // Prefer a candidate that doesn't immediately collide with a third item
        // when a same-cost alternative exists — cheap one-step look-ahead.
        const trial = { ...sliding, x: next.x, y: next.y };
        const hitsOther = items.some(
          (item) => item !== sliding && item !== anchor && rectsOverlap(trial, item),
        );
        if (hitsOther) {
          // Try remaining directions manually for a free landing.
          const alts = (
            [
              { preferLeft: true },
              { preferRight: true },
              { preferUp: true },
              { preferDown: true },
            ] as const
          )
            .map((b) => minimalClearance(anchor, sliding, cols, { ...bias, ...b }))
            .filter(Boolean) as Array<{ x: number; y: number }>;

          let placed = false;
          for (const alt of alts) {
            const t = { ...sliding, x: alt.x, y: alt.y };
            if (!rectsOverlap(anchor, t) && !items.some((item) => item !== sliding && item !== anchor && rectsOverlap(t, item))) {
              sliding.x = alt.x;
              sliding.y = alt.y;
              placed = true;
              progressed = true;
              break;
            }
          }
          if (!placed) {
            sliding.x = next.x;
            sliding.y = next.y;
            progressed = true;
          }
        } else {
          sliding.x = next.x;
          sliding.y = next.y;
          progressed = true;
        }
      }
    }

    if (!progressed) break;
  }

  // ── Phase 3: nearest free cell for anyone still stuck ────────────────────
  if (hasLayoutOverlaps(items)) {
    const fixed: T[] = [];
    const rest: T[] = [];
    for (const item of items) {
      if (movedId && String(item.i) === movedId) fixed.push(item);
      else rest.push(item);
    }
    rest.sort((a, b) => a.y - b.y || a.x - b.x || String(a.i).localeCompare(String(b.i)));

    const placed: GridRect[] = fixed.map((item) => ({
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      i: item.i,
    }));

    for (const item of rest) {
      if (!placed.some((p) => rectsOverlap(item, p))) {
        placed.push({ x: item.x, y: item.y, w: item.w, h: item.h, i: item.i });
        continue;
      }
      const free = findFreeLayoutPosition(placed, item, cols);
      item.x = free.x;
      item.y = free.y;
      placed.push({ x: item.x, y: item.y, w: item.w, h: item.h, i: item.i });
    }

    if (hasLayoutOverlaps(items) && !movedId) {
      const ordered = [...items].sort(
        (a, b) => a.y - b.y || a.x - b.x || String(a.i).localeCompare(String(b.i)),
      );
      const seated: GridRect[] = [];
      for (const item of ordered) {
        const free = findFreeLayoutPosition(seated, item, cols);
        item.x = free.x;
        item.y = free.y;
        seated.push({ x: item.x, y: item.y, w: item.w, h: item.h, i: item.i });
      }
    }
  }

  return items;
}
