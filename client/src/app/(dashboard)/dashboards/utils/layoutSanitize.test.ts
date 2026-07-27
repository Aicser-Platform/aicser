import { describe, expect, it } from 'vitest';
import { hasLayoutOverlaps, resolveLayoutCollisions, placePinnedLayoutItem } from './layoutSanitize';

describe('resolveLayoutCollisions', () => {
  it('swaps when dropping a widget onto a comparable neighbor', () => {
    const before = { i: 'a', x: 0, y: 0, w: 3, h: 3 };
    const layout = [
      { i: 'a', x: 3, y: 0, w: 3, h: 3 }, // dropped onto b
      { i: 'b', x: 3, y: 0, w: 3, h: 3 },
    ];
    const next = resolveLayoutCollisions(layout, { movedId: 'a', cols: 12, before });
    const a = next.find((item) => item.i === 'a')!;
    const b = next.find((item) => item.i === 'b')!;
    expect(a).toMatchObject({ x: 3, y: 0, w: 3, h: 3 });
    expect(b).toMatchObject({ x: 0, y: 0, w: 3, h: 3 }); // took a's old slot
    expect(hasLayoutOverlaps(next)).toBe(false);
  });

  it('nudges just enough horizontally instead of dumping down', () => {
    const before = { i: 'a', x: 0, y: 0, w: 3, h: 3 };
    const layout = [
      { i: 'a', x: 2, y: 0, w: 3, h: 3 }, // dragged slightly into b
      { i: 'b', x: 4, y: 0, w: 3, h: 3 },
    ];
    const next = resolveLayoutCollisions(layout, { movedId: 'a', cols: 12, before });
    const a = next.find((item) => item.i === 'a')!;
    const b = next.find((item) => item.i === 'b')!;
    expect(a).toMatchObject({ x: 2, y: 0, w: 3, h: 3 });
    expect(b.y).toBe(0); // stayed on the same row
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w);
    expect(hasLayoutOverlaps(next)).toBe(false);
  });

  it('on resize-right pushes the neighbor right just enough', () => {
    const before = { i: 'a', x: 0, y: 0, w: 3, h: 3 };
    const layout = [
      { i: 'a', x: 0, y: 0, w: 5, h: 3 },
      { i: 'b', x: 3, y: 0, w: 3, h: 3 },
    ];
    const next = resolveLayoutCollisions(layout, { movedId: 'a', cols: 12, before });
    const a = next.find((item) => item.i === 'a')!;
    const b = next.find((item) => item.i === 'b')!;
    expect(a).toMatchObject({ x: 0, y: 0, w: 5, h: 3 });
    expect(b.x).toBe(5);
    expect(b.y).toBe(0);
    expect(hasLayoutOverlaps(next)).toBe(false);
  });

  it('on resize-down pushes the neighbor down just enough', () => {
    const before = { i: 'a', x: 0, y: 0, w: 4, h: 2 };
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 0, y: 2, w: 4, h: 2 },
    ];
    const next = resolveLayoutCollisions(layout, { movedId: 'a', cols: 12, before });
    const a = next.find((item) => item.i === 'a')!;
    const b = next.find((item) => item.i === 'b')!;
    expect(a.h).toBe(4);
    expect(b.y).toBe(4);
    expect(hasLayoutOverlaps(next)).toBe(false);
  });

  it('leaves non-overlapping layouts unchanged', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 3 },
      { i: 'b', x: 4, y: 0, w: 4, h: 3 },
    ];
    expect(resolveLayoutCollisions(layout, { movedId: 'a' })).toEqual(layout);
  });

  it('never returns overlaps even for fully coincident widgets', () => {
    const layout = [
      { i: 'a', x: 2, y: 2, w: 4, h: 4 },
      { i: 'b', x: 2, y: 2, w: 4, h: 4 },
      { i: 'c', x: 2, y: 2, w: 4, h: 4 },
    ];
    const next = resolveLayoutCollisions(layout, { movedId: 'a', cols: 12 });
    const a = next.find((item) => item.i === 'a')!;
    expect(a).toMatchObject({ x: 2, y: 2, w: 4, h: 4 });
    expect(hasLayoutOverlaps(next)).toBe(false);
  });
});

describe('placePinnedLayoutItem', () => {
  it('places below existing neighbors instead of stacking at 0,0', () => {
    const existing = [
      { x: 0, y: 0, w: 6, h: 5 },
      { x: 6, y: 0, w: 6, h: 5 },
    ];
    const placed = placePinnedLayoutItem(existing, { w: 6, h: 8 });
    expect(placed.y).toBeGreaterThanOrEqual(5);
    expect(hasLayoutOverlaps([...existing, placed])).toBe(false);
  });

  it('fills a free side gap when bottom-left is blocked', () => {
    const existing = [{ x: 0, y: 0, w: 6, h: 10 }];
    const placed = placePinnedLayoutItem(existing, { x: 0, y: 0, w: 6, h: 5 });
    expect(hasLayoutOverlaps([...existing, placed])).toBe(false);
    expect(placed.x === 0 && placed.y === 0).toBe(false);
  });
});
