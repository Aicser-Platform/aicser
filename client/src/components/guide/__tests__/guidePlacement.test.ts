import { describe, expect, it } from 'vitest';
import { placeCard } from '../guidePlacement';

const view = { width: 1400, height: 800 };
const card = { width: 300, height: 120 };
const overlaps = (a: { left: number; top: number; width: number; height: number }, x: number, y: number) =>
  x < a.left + a.width && x + card.width > a.left && y < a.top + a.height && y + card.height > a.top;

describe('placeCard', () => {
  it('sits above a composer at the bottom of the page, without covering it', () => {
    const target = { left: 100, top: 680, width: 900, height: 110 };
    const place = placeCard(target, card, view);
    expect(place.side).toBe('top');
    expect(overlaps(target, place.x, place.y)).toBe(false);
  });

  it('sits beside a tall sidebar target', () => {
    const place = placeCard({ left: 0, top: 100, width: 60, height: 300 }, card, view);
    expect(place.side).toBe('right');
  });

  it('stays on screen for a target at the edge', () => {
    const place = placeCard({ left: 1360, top: 10, width: 30, height: 30 }, card, view);
    expect(place.x + card.width).toBeLessThanOrEqual(view.width);
    expect(place.x).toBeGreaterThanOrEqual(0);
  });

  it('points the arrow at the target even when the card is pushed sideways', () => {
    const place = placeCard({ left: 1360, top: 10, width: 30, height: 30 }, card, view);
    expect(place.x + place.arrow).toBeGreaterThan(1340);
  });

  it('waits in the corner with nothing to point at, or no room beside it', () => {
    expect(placeCard(null, card, view).side).toBe('corner');
    expect(placeCard({ left: 0, top: 0, width: 1400, height: 800 }, card, view).side).toBe('corner');
  });

  it('docks to the bottom on a phone', () => {
    expect(placeCard({ left: 10, top: 10, width: 50, height: 50 }, card, { width: 390, height: 800 }).side).toBe('dock');
  });
});
