// Semantic models (metrics, dimensions, relationships, verified questions). Written for desktop from the server
// contracts (nothing ported from web's ee/ Semantic Studio client):
// - ../aicser/server/ee/modules/ai/semantic_router.py, mounted at `api/semantic` (Enterprise server, plan feature
//   `platform_services`; certify / deprecate need `govern` + `semantic:certify`).
// - ../aicser/server/src/modules/data/model_router.py, mounted at `data/data-sources/{id}/model` (relationships).
import { z } from 'zod';
import { fetchApi } from '@/utils/api';

const id = z.union([z.string(), z.number()]).transform(String);
const text = z.string().nullish();
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// ---------------------------------------------------------------- metrics

export const MetricSchema = z.looseObject({
  id,
  name: z.string(),
  expression: z.string().catch(''),
  description: text,
  category: text,
  owner: text,
  data_source_id: id.nullish(),
  metric_type: text,
  certified: z.boolean().nullish(),
  certified_at: text,
  deprecated_at: text,
  replaced_by: text,
  /** An edit to a certified metric waits here until it is published (or discarded). */
  pending_change: z.record(z.string(), z.unknown()).nullish(),
  source: text,
  updated_at: text,
});
export type Metric = z.infer<typeof MetricSchema>;

export type MetricStatus = 'official' | 'draft' | 'changed' | 'retired';

/** A metric's state in plain words: retired, official (with or without a pending change) or draft. */
export function metricStatus(m: Metric): MetricStatus {
  if (m.deprecated_at) return 'retired';
  if (m.certified) return m.pending_change && Object.keys(m.pending_change).length ? 'changed' : 'official';
  return 'draft';
}

const sourceQuery = (dataSourceId: string) => `?data_source_id=${encodeURIComponent(dataSourceId)}`;

export async function listMetrics(dataSourceId: string): Promise<Metric[]> {
  const res = z
    .looseObject({ metrics: z.array(MetricSchema).catch([]) })
    .parse(await fetchApi(`/api/semantic/metrics${sourceQuery(dataSourceId)}`));
  return res.metrics;
}

export interface MetricInput {
  name: string;
  expression: string;
  description?: string;
  data_source_id: string;
  project_id?: string | null;
}

export async function createMetric(input: MetricInput): Promise<void> {
  await fetchApi('/api/semantic/metrics', { method: 'POST', ...json({ category: 'general', ...input }) });
}

export async function updateMetric(
  metricId: string,
  patch: Partial<Pick<MetricInput, 'name' | 'expression' | 'description'>>
): Promise<void> {
  await fetchApi(`/api/semantic/metrics/${encodeURIComponent(metricId)}`, { method: 'PATCH', ...json(patch) });
}

export async function deleteMetric(metricId: string): Promise<void> {
  await fetchApi(`/api/semantic/metrics/${encodeURIComponent(metricId)}`, { method: 'DELETE' });
}

export type MetricAction = 'certify' | 'deprecate' | 'reinstate' | 'publish' | 'discard';

/** Certify (official), retire, bring back, publish or discard a pending change. */
export async function metricAction(metricId: string, action: MetricAction): Promise<void> {
  await fetchApi(`/api/semantic/metrics/${encodeURIComponent(metricId)}/${action}`, { method: 'POST', ...json({}) });
}

// ---------------------------------------------------------------- dimensions

export const DIMENSION_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

export const DimensionSchema = z.looseObject({
  id,
  name: z.string(),
  expression: z.string().catch(''),
  description: text,
  dimension_type: z.enum(['category', 'time']).catch('category'),
  default_grain: text,
  certified: z.boolean().nullish(),
  data_source_id: id.nullish(),
});
export type Dimension = z.infer<typeof DimensionSchema>;

export async function listDimensions(dataSourceId: string): Promise<Dimension[]> {
  const res = z
    .looseObject({ dimensions: z.array(DimensionSchema).catch([]) })
    .parse(await fetchApi(`/api/semantic/dimensions${sourceQuery(dataSourceId)}`));
  return res.dimensions;
}

export interface DimensionInput {
  name: string;
  expression: string;
  description?: string;
  dimension_type: 'category' | 'time';
  default_grain?: string | null;
  data_source_id: string;
  project_id?: string | null;
}

export async function createDimension(input: DimensionInput): Promise<void> {
  await fetchApi('/api/semantic/dimensions', { method: 'POST', ...json(input) });
}

export async function updateDimension(
  dimensionId: string,
  patch: Partial<Omit<DimensionInput, 'data_source_id' | 'project_id'>>
): Promise<void> {
  await fetchApi(`/api/semantic/dimensions/${encodeURIComponent(dimensionId)}`, { method: 'PATCH', ...json(patch) });
}

export async function deleteDimension(dimensionId: string): Promise<void> {
  await fetchApi(`/api/semantic/dimensions/${encodeURIComponent(dimensionId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- verified questions

export const QuestionSchema = z.looseObject({
  id,
  question: z.string(),
  sql: z.string(),
  verified_at: text,
  used: z.number().catch(0),
});
export type VerifiedQuestion = z.infer<typeof QuestionSchema>;

export async function listQuestions(dataSourceId: string): Promise<VerifiedQuestion[]> {
  const res = z
    .looseObject({ questions: z.array(QuestionSchema).catch([]) })
    .parse(await fetchApi(`/api/semantic/verified-questions${sourceQuery(dataSourceId)}`));
  return res.questions;
}

export async function saveQuestion(
  input: { question: string; sql: string },
  target: { dataSourceId: string } | { questionId: string }
): Promise<void> {
  if ('questionId' in target) {
    await fetchApi(`/api/semantic/verified-questions/${encodeURIComponent(target.questionId)}`, {
      method: 'PATCH',
      ...json(input),
    });
  } else {
    await fetchApi('/api/semantic/verified-questions', {
      method: 'POST',
      ...json({ ...input, data_source_id: target.dataSourceId }),
    });
  }
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await fetchApi(`/api/semantic/verified-questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- try it

const PreviewSchema = z.looseObject({
  success: z.boolean().catch(false),
  sql: z.string().nullish(),
  rows: z.array(z.record(z.string(), z.unknown())).catch([]),
  row_count: z.number().nullish(),
  error: z.string().nullish(),
});
export type SemanticPreview = z.infer<typeof PreviewSchema>;

/** Runs a metric by dimensions (and a time grain) the way Ask and dashboards would. */
export async function previewMetric(input: {
  data_source_id: string;
  metric: string;
  dimensions: string[];
  time_grain?: string | null;
  project_id?: string | null;
  limit?: number;
}): Promise<SemanticPreview> {
  return PreviewSchema.parse(
    await fetchApi('/api/semantic/preview', { method: 'POST', ...json({ limit: 25, ...input }) })
  );
}

// ---------------------------------------------------------------- hub

export const SourceSummarySchema = z.looseObject({
  data_source_id: id,
  name: z.string(),
  type: text,
  metric_count: z.number().catch(0),
  dimension_count: z.number().catch(0),
  join_count: z.number().catch(0),
  certified_metric_count: z.number().catch(0),
});
export type SourceSummary = z.infer<typeof SourceSummarySchema>;

/** Per-connection counts for the Semantic models list (only connections the caller can open). */
export async function projectSummary(projectId: string): Promise<SourceSummary[]> {
  const res = z
    .looseObject({ sources: z.array(SourceSummarySchema).catch([]) })
    .parse(await fetchApi(`/api/semantic/project-summary?project_id=${encodeURIComponent(projectId)}`));
  return res.sources;
}

// ---------------------------------------------------------------- relationships

export const CARDINALITIES = ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'] as const;
export const JOIN_TYPES = ['LEFT', 'INNER', 'FULL'] as const;

export const RelationshipSchema = z.looseObject({
  id,
  from_table: z.string(),
  from_column: z.string(),
  to_table: z.string(),
  to_column: z.string(),
  to_data_source_id: id.nullish(),
  join_type: z.string().catch('LEFT'),
  cardinality: z.string().catch('one_to_many'),
  is_active: z.boolean().catch(true),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

const modelPath = (dataSourceId: string) => `/data/data-sources/${encodeURIComponent(dataSourceId)}/model`;

export async function listRelationships(dataSourceId: string): Promise<Relationship[]> {
  const res = z
    .looseObject({ relationships: z.array(RelationshipSchema).catch([]) })
    .parse(await fetchApi(`${modelPath(dataSourceId)}/relationships`));
  return res.relationships;
}

export interface RelationshipInput {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  join_type: string;
  cardinality: string;
}

export async function createRelationship(dataSourceId: string, input: RelationshipInput): Promise<void> {
  await fetchApi(`${modelPath(dataSourceId)}/relationships`, { method: 'POST', ...json(input) });
}

export async function updateRelationship(
  dataSourceId: string,
  relationshipId: string,
  patch: Partial<Pick<RelationshipInput, 'join_type' | 'cardinality'>> & { is_active?: boolean }
): Promise<void> {
  await fetchApi(`${modelPath(dataSourceId)}/relationships/${encodeURIComponent(relationshipId)}`, {
    method: 'PUT',
    ...json(patch),
  });
}

export async function deleteRelationship(dataSourceId: string, relationshipId: string): Promise<void> {
  await fetchApi(`${modelPath(dataSourceId)}/relationships/${encodeURIComponent(relationshipId)}`, {
    method: 'DELETE',
  });
}

/** Finds joins from matching key columns; returns how many it added. */
export async function autoDetectRelationships(dataSourceId: string): Promise<number> {
  const res = z
    .looseObject({ count: z.number().catch(0) })
    .parse(await fetchApi(`${modelPath(dataSourceId)}/auto-detect`, { method: 'POST', ...json({}) }));
  return res.count;
}
