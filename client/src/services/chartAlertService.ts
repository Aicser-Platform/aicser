import { fetchApi } from '@/utils/api';

export interface CreateChartAlertInput {
  title?: string;
  sqlQuery?: string;
  dataSourceId?: string | null;
  projectId?: string | null;
  suggestAlertLabel?: string;
  anomalyZscore?: number | null;
}

export async function createAlertFromChart(input: CreateChartAlertInput): Promise<unknown> {
  const sql = input.sqlQuery?.trim();
  if (!sql) {
    throw new Error('alert_no_sql');
  }

  const threshold = Math.abs(Number(input.anomalyZscore) || 2.0);
  const name = input.title?.slice(0, 80) || 'Chart monitoring alert';

  return fetchApi('alerts/rules', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: input.suggestAlertLabel || 'Monitoring alert created from chat chart analysis.',
      data_source_id: input.dataSourceId || undefined,
      condition_sql: sql,
      threshold_operator: '>',
      threshold_value: threshold,
      window_minutes: 60,
      severity: 'warning',
      channels: [],
      is_active: true,
      project_id: input.projectId != null ? String(input.projectId) : undefined,
    }),
  });
}
