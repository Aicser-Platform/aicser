import type { DataSource } from '@/stores/useDataSourceStore';

const SEMANTIC_ELIGIBLE_TYPES = new Set([
  'database',
  'warehouse',
  'cube',
  'file',
  'sample_duckdb',
  'google_sheets',
]);

export const isSemanticModelEligible = (ds: Pick<DataSource, 'type'>): boolean =>
  SEMANTIC_ELIGIBLE_TYPES.has((ds.type || '').toLowerCase());
