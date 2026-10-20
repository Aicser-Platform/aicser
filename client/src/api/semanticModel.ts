import { fetchApi } from '@/utils/api';

/** A connection's semantic model as other surfaces use it (SQL editor, notebooks, sheets, dashboards). */
export type ModelMetric = { id: string; name: string; description?: string; certified?: boolean; format?: string | null };
export type ModelDimension = { id: string; name: string; dimension_type?: 'category' | 'time'; default_grain?: string | null };

const qs = (dataSourceId: string, projectId?: string | null) =>
  `data_source_id=${encodeURIComponent(dataSourceId)}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}`;

/** Official metrics first, then by name. */
export const listModelMetrics = (dataSourceId: string, projectId?: string | null) =>
  fetchApi<{ metrics?: ModelMetric[] }>(`semantic/metrics?${qs(dataSourceId, projectId)}`).then((r) =>
    [...(r.metrics ?? [])].sort((a, b) => Number(Boolean(b.certified)) - Number(Boolean(a.certified)) || a.name.localeCompare(b.name)),
  );

export const listModelDimensions = (dataSourceId: string, projectId?: string | null) =>
  fetchApi<{ dimensions?: ModelDimension[] }>(`semantic/dimensions?${qs(dataSourceId, projectId)}`).then((r) => r.dimensions ?? []);

/**
 * A metric by dimensions and period as SQL, compiled by the semantic layer (joins, calendar)
 * without running it; whoever runs it does so under their own access rules.
 */
export const compileMetric = (
  dataSourceId: string,
  body: { metric: string; dimensions?: string[]; time_grain?: string | null; limit?: number; project_id?: string | null },
) =>
  fetchApi<{ sql: string }>('semantic/compile', {
    method: 'POST',
    body: JSON.stringify({ data_source_id: dataSourceId, limit: 10000, ...body, time_grain: body.time_grain || undefined }),
  }).then((r) => r.sql);
