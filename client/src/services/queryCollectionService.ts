/**
 * Saved-query collections — mirrors chart/dashboard library collection CRUD.
 */

import { fetchApi } from '@/utils/api';

export type QueryCollection = {
  id: number | string;
  name: string;
  sortOrder?: number;
  createdAt?: string;
};

function scopedQs(organizationId?: string | null, projectId?: string | null): string {
  const params = new URLSearchParams();
  if (organizationId) params.set('organization_id', organizationId);
  if (projectId) params.set('project_id', projectId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

class QueryCollectionService {
  async list(
    organizationId?: string | null,
    projectId?: string | null,
  ): Promise<QueryCollection[]> {
    const data = await fetchApi<{ collections?: QueryCollection[] }>(
      `queries/collections${scopedQs(organizationId, projectId)}`,
    );
    return Array.isArray(data?.collections) ? data.collections : [];
  }

  async create(
    name: string,
    organizationId?: string | null,
    projectId?: string | null,
  ): Promise<QueryCollection> {
    return await fetchApi<QueryCollection>(
      `queries/collections${scopedQs(organizationId, projectId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    );
  }

  async rename(
    collectionId: number | string,
    name: string,
    organizationId?: string | null,
    projectId?: string | null,
  ): Promise<QueryCollection> {
    return await fetchApi<QueryCollection>(
      `queries/collections/${collectionId}${scopedQs(organizationId, projectId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ name }),
      },
    );
  }

  async delete(
    collectionId: number | string,
    organizationId?: string | null,
    projectId?: string | null,
  ): Promise<void> {
    await fetchApi(`queries/collections/${collectionId}${scopedQs(organizationId, projectId)}`, {
      method: 'DELETE',
    });
  }

  async assign(
    queryId: number | string,
    collectionId: number | string | null,
    organizationId?: string | null,
    projectId?: string | null,
  ): Promise<void> {
    await fetchApi(
      `queries/saved-queries/${queryId}/collection${scopedQs(organizationId, projectId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ collectionId }),
      },
    );
  }
}

export const queryCollectionService = new QueryCollectionService();
