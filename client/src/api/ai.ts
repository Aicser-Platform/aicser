import { fetchApi } from '@/utils/api';

export type AiModel = {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  tier?: string;
  configured_by?: string | null;
};

export async function getAiModels(): Promise<AiModel[]> {
  const res = await fetchApi<{ models?: AiModel[] }>('ai/models');
  return res.models ?? [];
}
