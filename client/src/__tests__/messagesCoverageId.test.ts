import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../scripts/i18n-coverage.mjs';

describe('i18n indonesian (id) coverage gate', () => {
  // Baseline locked at Week 2 (Batch 1: settings, chat_page, chat): 60.91% coverage (9,685 translated keys out of 15,901 total)
  // This baseline threshold increases as translation batches land.
  const MINIMUM_COVERAGE_PERCENT = 60.5;
  const MINIMUM_TRANSLATED_KEYS = 9600;

  it('maintains or improves id translation coverage without regressions', () => {
    const { totals } = computeCoverage();

    expect(totals.missing).toBe(0);
    expect(totals.translated).toBeGreaterThanOrEqual(MINIMUM_TRANSLATED_KEYS);
    expect(totals.coveragePct).toBeGreaterThanOrEqual(MINIMUM_COVERAGE_PERCENT);
  });
});
