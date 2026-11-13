import { describe, expect, it } from 'vitest';
import { layoutPages } from './pagination';

// Pages 100 px of text, 20 px between text areas (stride 120).
const g = { stride: 120, contentHeight: 100 };
const block = (pos: number, top: number, height: number, pageBreak = false) => ({ pos, top, height, pageBreak });

describe('layoutPages', () => {
  it('keeps a short document on one page', () => {
    expect(layoutPages([block(0, 0, 30), block(10, 40, 30)], g)).toEqual({ gaps: [], pages: 1 });
    expect(layoutPages([], g)).toEqual({ gaps: [], pages: 1 });
  });

  it('moves a block that would cross the page bottom to the next page', () => {
    const { gaps, pages } = layoutPages([block(0, 0, 60), block(10, 70, 40), block(20, 115, 20)], g);
    // The second block (70–110) crosses 100: a 50 px gap puts it at 120; the third follows at 165.
    expect(gaps).toEqual([{ pos: 10, height: 50 }]);
    expect(pages).toBe(2);
  });

  it('starts what follows a page break on a new page', () => {
    const { gaps, pages } = layoutPages([block(0, 0, 10), block(5, 15, 10, true), block(6, 30, 10)], g);
    expect(gaps).toEqual([{ pos: 6, height: 90 }]);
    expect(pages).toBe(2);
  });

  it('lets a block taller than a page run on, and moves a block that would start in the gap', () => {
    // The tall block stays where it is (moving it would not help); the next one at 175 is inside page 2's text.
    expect(layoutPages([block(0, 0, 10), block(5, 20, 150), block(9, 175, 10)], g)).toEqual({ gaps: [], pages: 2 });
    // One that would start at 105 (between pages) moves to 120.
    const { gaps } = layoutPages([block(0, 0, 10), block(5, 20, 80), block(9, 105, 10)], g);
    expect(gaps).toEqual([{ pos: 9, height: 15 }]);
  });

  it('is stable: laying out the result again adds no gaps', () => {
    const units = [block(0, 0, 60), block(10, 70, 40)];
    const first = layoutPages(units, g);
    expect(first.gaps).toHaveLength(1);
    // Measured again with the gap in place, natural positions are the same, so the layout is the same.
    expect(layoutPages(units, g)).toEqual(first);
  });

  it('uses whole-pixel gaps for page sizes in mm, so measuring again (whole pixels) gives the same gaps', () => {
    // A4 at 96 dpi: 1122.52 px page + 24 px between pages; the text area is the page minus 2 × 96 px margins.
    const a4 = { stride: 1146.52, contentHeight: 930.52 };
    const units = [block(0, 0, 900), block(10, 918.48, 28)];
    const first = layoutPages(units, a4);
    expect(first.gaps).toEqual([{ pos: 10, height: 228 }]);
    // The browser rounds positions: the block measures at 918 or 919; the gap stays within a pixel.
    for (const top of [918, 919, 918.96]) {
      const again = layoutPages([block(0, 0, 900), block(10, top, 28)], a4);
      expect(Math.abs(again.gaps[0]!.height - 228)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(again.gaps[0]!.height)).toBe(true);
    }
  });
});
