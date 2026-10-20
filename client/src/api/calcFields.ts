import { fetchApi } from '@/utils/api';

export type CalcField = {
  id: string;
  name: string;
  expression: string;
  description?: string;
  category?: string;
  certified?: boolean;
  created_at?: string;
};

export async function listCalcFields(dataSourceId: string): Promise<CalcField[]> {
  const res = await fetchApi<{ calc_fields?: CalcField[] }>(
    `data/data-sources/${encodeURIComponent(dataSourceId)}/model/calc-fields`,
  );
  return res?.calc_fields ?? [];
}

export async function createCalcField(
  dataSourceId: string,
  body: { name: string; expression: string; description?: string; category?: string },
): Promise<CalcField> {
  return fetchApi(`data/data-sources/${encodeURIComponent(dataSourceId)}/model/calc-fields`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteCalcField(dataSourceId: string, fieldId: string): Promise<void> {
  await fetchApi(`data/data-sources/${encodeURIComponent(dataSourceId)}/model/calc-fields/${encodeURIComponent(fieldId)}`, {
    method: 'DELETE',
  });
}
