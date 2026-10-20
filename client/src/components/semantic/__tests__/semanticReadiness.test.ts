import { describe, expect, it } from 'vitest';
import {
  semanticReadinessFromOverview,
  semanticSectionForReadiness,
} from '../semanticReadiness';

describe('semanticReadinessFromOverview', () => {
  it('detects empty model', () => {
    expect(semanticReadinessFromOverview({})).toBe('needs_relationships');
  });

  it('detects joins without metrics', () => {
    expect(semanticReadinessFromOverview({ join_count: 2 })).toBe('needs_metrics');
  });

  it('detects uncertified metrics', () => {
    expect(semanticReadinessFromOverview({ metric_count: 3, join_count: 1 })).toBe('needs_certification');
  });

  it('detects ready', () => {
    expect(semanticReadinessFromOverview({ metric_count: 2, certified_metric_count: 1 })).toBe('ready');
  });
});

describe('semanticSectionForReadiness', () => {
  it('maps to workbench steps', () => {
    expect(semanticSectionForReadiness('needs_relationships')).toBe('joins');
    expect(semanticSectionForReadiness('needs_metrics')).toBe('metrics');
  });
});
