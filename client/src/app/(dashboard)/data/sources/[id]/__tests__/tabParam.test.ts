import { describe, expect, it } from 'vitest';
import { parseTabParam } from '../_components/tabParam';

describe('parseTabParam', () => {
  it('accepts every known tab', () => {
    expect(parseTabParam('overview')).toBe('overview');
    expect(parseTabParam('schema')).toBe('schema');
    expect(parseTabParam('permissions')).toBe('permissions');
    expect(parseTabParam('row-filters')).toBe('row-filters');
    expect(parseTabParam('column-rules')).toBe('column-rules');
  });

  it('falls back to overview for anything else', () => {
    expect(parseTabParam(null)).toBe('overview');
    expect(parseTabParam('')).toBe('overview');
    expect(parseTabParam('nonsense')).toBe('overview');
  });
});
