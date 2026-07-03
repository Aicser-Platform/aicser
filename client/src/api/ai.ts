import { fetchApi } from '@/utils/api';

export type AiModel = {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  tier?: string;
  configured_by?: string | null;
};

export type GenerateSqlPayload = {
  question: string;
  data_source_id: string;
  model?: string;
};

export type GenerateSqlResult = {
  success: boolean;
  sql: string;
  model: string;
  provider: string;
  dialect: string;
  warning?: string | null;
};

export async function getAiModels(): Promise<AiModel[]> {
  const res = await fetchApi<{ models?: AiModel[] }>('ai/models');
  return res.models ?? [];
}

export async function generateSql(payload: GenerateSqlPayload): Promise<GenerateSqlResult> {
  return fetchApi<GenerateSqlResult>('ai/text-to-sql', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
