// Ported from ../aicser/client/src/components/semantic/semanticReadiness.ts and
// ../aicser/client/src/components/data/modelEligible.ts @ 749d38d (see PORTING.md); labels from web's
// `semantic_layer_hub` messages.

/** The studio's sections (web `?section=`). */
export const SEMANTIC_SECTIONS = ['metrics', 'dimensions', 'joins', 'questions', 'try'] as const;
export type SemanticSection = (typeof SEMANTIC_SECTIONS)[number];

export type SemanticReadiness = 'needs_relationships' | 'needs_metrics' | 'needs_certification' | 'ready';

export const READINESS_LABEL: Record<SemanticReadiness, string> = {
  needs_relationships: 'Connect tables',
  needs_metrics: 'Add metrics',
  needs_certification: 'Review & certify',
  ready: 'Ready for Ask',
};

/** Data source types that support table relationships and semantic modeling. */
const MODEL_ELIGIBLE_TYPES = new Set([
  'database',
  'warehouse',
  'cube',
  'file',
  'google_sheets',
  'sample_duckdb',
  'api',
]);

export function isModelEligible(type: string | undefined | null): boolean {
  return MODEL_ELIGIBLE_TYPES.has((type || '').toLowerCase());
}

/** A single-table file or one-sheet source: relationships are optional. */
export function isSingleTableSource(sourceType?: string | null, tableCount?: number | null): boolean {
  const t = (sourceType || '').toLowerCase();
  if (t !== 'file' && t !== 'google_sheets') return tableCount != null && tableCount <= 1;
  if (tableCount == null) return t === 'file';
  return tableCount <= 1;
}

export function readinessOf(
  counts: { metric_count?: number; join_count?: number; certified_metric_count?: number },
  singleTableSource = false
): SemanticReadiness {
  const metrics = Number(counts.metric_count) || 0;
  const joins = Number(counts.join_count) || 0;
  const certified = Number(counts.certified_metric_count) || 0;
  if (metrics === 0 && joins === 0) return singleTableSource ? 'needs_metrics' : 'needs_relationships';
  if (metrics === 0) return 'needs_metrics';
  if (certified === 0) return 'needs_certification';
  return 'ready';
}

/** Where to open a model so its next step is in front. */
export function sectionFor(readiness: SemanticReadiness): SemanticSection {
  return readiness === 'needs_relationships' ? 'joins' : 'metrics';
}
