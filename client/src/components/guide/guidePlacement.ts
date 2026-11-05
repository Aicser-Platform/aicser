/** Where the guide's card sits. Pure, so the layout rules can be tested without a browser. */

export type GuideSide = 'top' | 'bottom' | 'left' | 'right' | 'corner' | 'dock';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  side: GuideSide;
  /** Distance along the card's edge to the target's centre, for the arrow. */
  arrow: number;
}

const EDGE = 12;
const GAP = 14;
const ARROW_INSET = 18;
const PHONE_WIDTH = 600;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Next to the target, on the first side with room, and never over it. With nothing to point at, or
 * no room on any side, it waits in the corner where it covers the least. Phones dock it to the bottom.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
): Placement {
  if (view.width < PHONE_WIDTH) {
    return { x: EDGE, y: view.height - card.height - EDGE, side: 'dock', arrow: 0 };
  }
  const corner: Placement = {
    x: view.width - card.width - EDGE * 2,
    y: view.height - card.height - EDGE * 2,
    side: 'corner',
    arrow: 0,
  };
  if (!target) return corner;

  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const room: Record<'top' | 'bottom' | 'left' | 'right', number> = {
    bottom: view.height - bottom - GAP - EDGE - card.height,
    top: target.top - GAP - EDGE - card.height,
    right: view.width - right - GAP - EDGE - card.width,
    left: target.left - GAP - EDGE - card.width,
  };
  // Tall, thin targets (a sidebar link column) read best with the card beside them. Otherwise it
  // goes towards the middle of the page, away from the composer and header at the edges.
  const lowerHalf = target.top + target.height / 2 > view.height / 2;
  const order = target.height > target.width
    ? (['right', 'left', 'bottom', 'top'] as const)
    : lowerHalf ? (['top', 'bottom', 'right', 'left'] as const) : (['bottom', 'top', 'right', 'left'] as const);
  const side = order.find((name) => room[name] >= 0);
  if (!side) return corner;

  if (side === 'top' || side === 'bottom') {
    const centre = target.left + target.width / 2;
    const x = clamp(centre - card.width / 2, EDGE, view.width - card.width - EDGE);
    return {
      x,
      y: side === 'bottom' ? bottom + GAP : target.top - GAP - card.height,
      side,
      arrow: clamp(centre - x, ARROW_INSET, card.width - ARROW_INSET),
    };
  }
  const centre = target.top + target.height / 2;
  const y = clamp(centre - card.height / 2, EDGE, view.height - card.height - EDGE);
  return {
    x: side === 'right' ? right + GAP : target.left - GAP - card.width,
    y,
    side,
    arrow: clamp(centre - y, ARROW_INSET, card.height - ARROW_INSET),
  };
}
