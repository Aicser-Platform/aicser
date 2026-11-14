import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../scripts/i18n-coverage.mjs';

describe('i18n indonesian (id) coverage gate', () => {
  // Baseline locked at Week 1: 53.00% coverage (8,428 translated keys out of 15,899 total)
  // This baseline threshold increases as translation batches land.
  const MINIMUM_COVERAGE_PERCENT = 53.0;
  const MINIMUM_TRANSLATED_KEYS = 8420;

  it('maintains or improves id translation coverage without regressions', () => {
    const { totals } = computeCoverage();

    expect(totals.missing).toBe(0);
    expect(totals.translated).toBeGreaterThanOrEqual(MINIMUM_TRANSLATED_KEYS);
    expect(totals.coveragePct).toBeGreaterThanOrEqual(MINIMUM_COVERAGE_PERCENT);
  });
});
