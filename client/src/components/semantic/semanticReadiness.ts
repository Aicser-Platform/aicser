import type { SemanticLayerSection } from '@/app/(dashboard)/data/sources/[id]/_components/tabParam';

export type SemanticReadiness = 'needs_relationships' | 'needs_metrics' | 'needs_certification' | 'ready';

export const SEMANTIC_READINESS_TAG_COLOR: Record<SemanticReadiness, string> = {
  needs_relationships: 'orange',
  needs_metrics: 'gold',
  needs_certification: 'blue',
  ready: 'green',
};

export type SemanticOverviewCounts = {
  metric_count?: number;
  join_count?: number;
  certified_metric_count?: number;
};

export type SemanticReadinessOptions = {
  /** Single-table file or one-sheet source — relationships step optional */
  singleTableSource?: boolean;
};

export function isSingleTableFileSource(
  sourceType?: string | null,
  tableCount?: number | null,
): boolean {
  const t = (sourceType || '').toLowerCase();
  if (t !== 'file' && t !== 'google_sheets') return false;
  if (tableCount == null) return t === 'file';
  return tableCount <= 1;
}

/** Whether the relationships step is required before metrics make sense. */
export function needsRelationshipsStep(
  sourceType?: string | null,
  tableCount?: number | null,
): boolean {
  if (isSingleTableFileSource(sourceType, tableCount)) return false;
  if (tableCount != null && tableCount <= 1) return false;
  return true;
}

export function semanticReadinessFromOverview(
  ov: SemanticOverviewCounts,
  options?: SemanticReadinessOptions,
): SemanticReadiness {
  const metrics = Number(ov.metric_count) || 0;
  const joins = Number(ov.join_count) || 0;
  const certified = Number(ov.certified_metric_count) || 0;
  const skipJoins = options?.singleTableSource;
  if (metrics === 0 && joins === 0) {
    return skipJoins ? 'needs_metrics' : 'needs_relationships';
  }
  if (metrics === 0) return 'needs_metrics';
  if (certified === 0 && metrics > 0) return 'needs_certification';
  return 'ready';
}

export function semanticSectionForReadiness(readiness: SemanticReadiness): SemanticLayerSection {
  if (readiness === 'needs_relationships') return 'joins';
  if (readiness === 'needs_metrics' || readiness === 'needs_certification') return 'metrics';
  return 'metrics';
}
