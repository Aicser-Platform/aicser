import { fetchApi } from '@/utils/api';

export type DataModelRelationship = {
  id: string;
  data_source_id: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  join_type: string;
};

export async function listRelationships(dataSourceId: string): Promise<DataModelRelationship[]> {
  const res = await fetchApi<{ relationships: DataModelRelationship[] }>(
    `data/data-sources/${dataSourceId}/model/relationships`
  );
  return res?.relationships || [];
}

export async function createRelationship(
  dataSourceId: string,
  payload: Omit<DataModelRelationship, 'id' | 'data_source_id'>
): Promise<DataModelRelationship> {
  return fetchApi(`data/data-sources/${dataSourceId}/model/relationships`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteRelationship(dataSourceId: string, relationshipId: string): Promise<void> {
  await fetchApi(`data/data-sources/${dataSourceId}/model/relationships/${relationshipId}`, {
    method: 'DELETE',
  });
}

export async function autoDetectRelationships(dataSourceId: string): Promise<DataModelRelationship[]> {
  const res = await fetchApi<{ relationships: DataModelRelationship[] }>(
    `data/data-sources/${dataSourceId}/model/auto-detect`,
    { method: 'POST' }
  );
  return res?.relationships || [];
}
