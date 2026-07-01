import { ApiError, fetchApi } from '@/utils/api';

export type DataModelRelationship = {
  id: string;
  data_source_id: string;
  to_data_source_id?: string | null;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  join_type: string;
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_many';
  cross_filter_direction: 'single' | 'both';
  is_active: boolean;
  assume_integrity: boolean;
  created_at: string | null;
};

export type RelationshipCreatePayload = Omit<DataModelRelationship, 'id' | 'data_source_id' | 'created_at'>;
export type RelationshipUpdatePayload = Partial<Pick<DataModelRelationship, 'cardinality' | 'cross_filter_direction' | 'is_active' | 'assume_integrity'>>;

export async function listRelationships(dataSourceId: string): Promise<DataModelRelationship[]> {
  const res = await fetchApi<{ relationships: DataModelRelationship[] }>(
    `data/data-sources/${dataSourceId}/model/relationships`
  );
  return res?.relationships || [];
}

export async function createRelationship(
  dataSourceId: string,
  payload: RelationshipCreatePayload
): Promise<DataModelRelationship> {
  return fetchApi(`data/data-sources/${dataSourceId}/model/relationships`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateRelationship(
  dataSourceId: string,
  relationshipId: string,
  payload: RelationshipUpdatePayload
): Promise<DataModelRelationship> {
  return fetchApi(`data/data-sources/${dataSourceId}/model/relationships/${relationshipId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteRelationship(dataSourceId: string, relationshipId: string): Promise<void> {
  try {
    await fetchApi(`data/data-sources/${dataSourceId}/model/relationships/${relationshipId}`, {
      method: 'DELETE',
    });
  } catch (error) {
    // Treat delete as idempotent: if the row is already gone, the UI should close
    // and keep the optimistic removal instead of surfacing a false error.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

export async function autoDetectRelationships(dataSourceId: string): Promise<DataModelRelationship[]> {
  const res = await fetchApi<{ relationships: DataModelRelationship[] }>(
    `data/data-sources/${dataSourceId}/model/auto-detect`,
    { method: 'POST' }
  );
  return res?.relationships || [];
}
