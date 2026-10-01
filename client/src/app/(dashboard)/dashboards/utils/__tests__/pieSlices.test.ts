import { describe, expect, it } from 'vitest';
import { groupSmallSlices } from '../pieSlices';

const data = (n: number) => ({
  x: Array.from({ length: n }, (_, i) => `c${i}`),
  series: [{ name: 'v', data: Array.from({ length: n }, (_, i) => i + 1) }],
});

describe('pie slices', () => {
  it('keeps small pies as they are', () => {
    expect(groupSmallSlices(data(6) as never, 6, 'Other')).toEqual(data(6));
  });

  it('keeps the largest five and folds the rest into Other', () => {
    const out = groupSmallSlices(data(10) as never, 6, 'Other');
    expect(out.x).toEqual(['c9', 'c8', 'c7', 'c6', 'c5', 'Other']);
    expect(out.y?.[5]).toBe(1 + 2 + 3 + 4 + 5);
    expect(out.otherIndex).toBe(5);
  });

  it('shows every slice when asked', () => {
    expect(groupSmallSlices(data(10) as never, 0, 'Other').x).toHaveLength(10);
  });
});
