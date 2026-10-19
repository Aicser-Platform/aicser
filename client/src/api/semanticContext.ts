import { fetchApi } from '@/utils/api';

export type SemanticContextMetric = {
  id?: string;
  name: string;
  expression?: string;
  description?: string;
  certified?: boolean;
  metric_type?: string;
  source?: string;
};

export type SemanticContextJoin = {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  join_type?: string;
};

export type UnifiedSemanticContext = {
  metrics: SemanticContextMetric[];
  dimensions: { name: string; expression?: string; certified?: boolean; dimension_type?: 'category' | 'time'; default_grain?: string | null }[];
  join_paths: SemanticContextJoin[];
  time_dimensions?: { name: string; expression?: string; default_grain?: string | null }[];
  calendar?: { fiscal_year_start_month: number; week_start: 'monday' | 'sunday' };
  total_metrics?: number;
  certified_metric_count?: number;
  prompt_hint?: string;
};

export async function fetchSemanticContext(
  dataSourceId: string,
  projectId?: string | null,
): Promise<UnifiedSemanticContext> {
  const q = new URLSearchParams({ data_source_id: dataSourceId });
  if (projectId) q.set('project_id', projectId);
  const res = await fetchApi<{ success: boolean; context: UnifiedSemanticContext }>(
    `semantic/context?${q.toString()}`,
  );
  return res?.context || { metrics: [], dimensions: [], join_paths: [] };
}
