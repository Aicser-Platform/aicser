/**
 * Data source types that support table relationships and semantic modeling.
 * Align with /data “Open model” affordances (tabular / queryable sources).
 */
export const MODEL_ELIGIBLE_TYPES = new Set([
  'database',
  'warehouse',
  'cube',
  'file',
  'google_sheets',
  'sample_duckdb',
  'api',
]);

export function isModelEligibleDataSource(type: string | undefined | null): boolean {
  return MODEL_ELIGIBLE_TYPES.has((type || '').toLowerCase());
}

/** Types that appear on /data but cannot host metrics/joins (documents, KB, etc.). */
export const MODEL_INELIGIBLE_HINT_TYPES = new Set(['knowledge_base']);
