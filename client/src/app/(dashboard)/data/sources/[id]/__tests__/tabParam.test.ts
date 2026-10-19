import { describe, expect, it } from 'vitest';
import {
  parseAccessSubParam,
  parseSemanticSectionParam,
  parseTabParam,
  suggestSemanticSection,
} from '../_components/tabParam';

describe('parseTabParam', () => {
  it('accepts every known tab', () => {
    expect(parseTabParam('overview')).toBe('overview');
    expect(parseTabParam('schema')).toBe('schema');
    expect(parseTabParam('semantic')).toBe('semantic');
    expect(parseTabParam('access')).toBe('access');
  });

  it('maps legacy access tabs to access', () => {
    expect(parseTabParam('permissions')).toBe('access');
    expect(parseTabParam('row-filters')).toBe('access');
    expect(parseTabParam('column-rules')).toBe('access');
  });

  it('falls back to overview for anything else', () => {
    expect(parseTabParam(null)).toBe('overview');
    expect(parseTabParam('')).toBe('overview');
    expect(parseTabParam('nonsense')).toBe('overview');
  });
});

describe('parseAccessSubParam', () => {
  it('prefers access query param', () => {
    expect(parseAccessSubParam('access', 'row-filters')).toBe('row-filters');
  });

  it('infers from legacy tab', () => {
    expect(parseAccessSubParam('row-filters', null)).toBe('row-filters');
    expect(parseAccessSubParam('permissions', null)).toBe('sharing');
  });
});

describe('parseSemanticSectionParam', () => {
  it('returns null when section omitted', () => {
    expect(parseSemanticSectionParam(null)).toBeNull();
  });

  it('maps entity_graph alias', () => {
    expect(parseSemanticSectionParam('entity_graph')).toBe('joins');
  });
});

describe('suggestSemanticSection', () => {
  it('nudges to joins when empty', () => {
    expect(suggestSemanticSection(0, 0)).toBe('joins');
    expect(suggestSemanticSection(0, 0, true)).toBe('metrics');
    expect(suggestSemanticSection(0, 2)).toBe('metrics');
  });
});
