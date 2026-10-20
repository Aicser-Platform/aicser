import { fetchApi } from '@/utils/api';

export type SemanticDraftResult = {
  success?: boolean;
  data_source_id?: string;
  metrics_imported?: number;
  dimensions_imported?: number;
  join_paths_available?: number;
  error?: string;
};

export type SemanticDraftBatchSummary = {
  sources: number;
  metrics: number;
  dimensions: number;
  failed: string[];
};

/** Run AI semantic draft per source. Metrics/dimensions upsert by name — safe to re-run without duplicates. */
export async function runSemanticDraftForSources(
  sourceIds: string[],
  projectId?: string | null,
): Promise<SemanticDraftBatchSummary> {
  const q = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
  let metrics = 0;
  let dimensions = 0;
  const failed: string[] = [];

  for (const id of sourceIds) {
    try {
      const res = await fetchApi<SemanticDraftResult>(
        `semantic/generate/${encodeURIComponent(id)}${q}`,
        { method: 'POST' },
      );
      if (!res?.success) {
        failed.push(id);
        continue;
      }
      metrics += Number(res.metrics_imported) || 0;
      dimensions += Number(res.dimensions_imported) || 0;
    } catch {
      failed.push(id);
    }
  }

  return { sources: sourceIds.length - failed.length, metrics, dimensions, failed };
}
