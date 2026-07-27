/**
 * Dashboard library client — paginated lists, collections, favorites, recent.
 * Single source of truth for Studio / pin / visualize pickers (mirrors chartLibraryService).
 */

import { fetchApi } from '@/utils/api';

const IS_ENTERPRISE_EDITION =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' || process.env.EDITION === 'enterprise';

export type DashboardLibraryFacet = 'all' | 'recent' | 'favorites' | 'unfiled' | 'trash';

export type DashboardCollection = {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
};

export type DashboardLibraryItem = {
  id: string;
  title?: string;
  name?: string;
  description?: string | null;
  project_id?: string | null;
  collectionId?: string | null;
  isFavorite?: boolean;
  lastOpenedAt?: string | null;
  tags?: string[];
  chartCount?: number;
  config?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DashboardLibraryListResult = {
  dashboards: DashboardLibraryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

function normalizeProjectId(projectId?: string | number | null): string | null {
  if (projectId == null || projectId === '') return null;
  return String(projectId);
}

function scopedPath(projectId?: string | number | null, suffix = ''): string {
  const pid = normalizeProjectId(projectId);
  if (IS_ENTERPRISE_EDITION && !pid) {
    throw new Error('Select a project before loading dashboards');
  }
  const base = pid ? `dashboards?project_id=${encodeURIComponent(pid)}` : 'dashboards';
  if (!suffix) return base;
  if (suffix.startsWith('?')) {
    return pid
      ? `dashboards${suffix}&project_id=${encodeURIComponent(pid)}`
      : `dashboards${suffix}`;
  }
  if (suffix.startsWith('/')) {
    return pid
      ? `dashboards${suffix}${suffix.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(pid)}`
      : `dashboards${suffix}`;
  }
  return base;
}

class DashboardLibraryServiceClient {
  async list(
    opts: {
      projectId?: string | number | null;
      q?: string;
      facet?: DashboardLibraryFacet;
      collectionId?: string | null;
      limit?: number;
      offset?: number;
      detail?: 'summary' | 'full';
    } = {},
  ): Promise<DashboardLibraryListResult> {
    const params = new URLSearchParams();
    const pid = normalizeProjectId(opts.projectId);
    if (IS_ENTERPRISE_EDITION) {
      if (!pid) throw new Error('Select a project before loading dashboards');
      params.set('project_id', pid);
    } else if (pid) {
      params.set('project_id', pid);
    }
    if (opts.q) params.set('q', opts.q);
    if (opts.facet) params.set('facet', opts.facet);
    if (opts.collectionId) params.set('collection_id', opts.collectionId);
    params.set('limit', String(opts.limit ?? 50));
    params.set('offset', String(opts.offset ?? 0));
    params.set('detail', opts.detail ?? 'summary');
    const data = await fetchApi<{
      dashboards?: DashboardLibraryItem[];
      total?: number;
      limit?: number;
      offset?: number;
      hasMore?: boolean;
    }>(`dashboards?${params.toString()}`);
    return {
      dashboards: Array.isArray(data?.dashboards) ? data.dashboards : [],
      total: Number(data?.total ?? 0),
      limit: Number(data?.limit ?? opts.limit ?? 50),
      offset: Number(data?.offset ?? opts.offset ?? 0),
      hasMore: Boolean(data?.hasMore),
    };
  }

  async listCollections(projectId?: string | number | null): Promise<DashboardCollection[]> {
    const data = await fetchApi<{ collections?: DashboardCollection[] }>(
      scopedPath(projectId, '/collections'),
    );
    return Array.isArray(data?.collections) ? data.collections : [];
  }

  async createCollection(
    name: string,
    projectId?: string | number | null,
    parentId?: string | null,
  ): Promise<DashboardCollection> {
    return await fetchApi<DashboardCollection>(scopedPath(projectId, '/collections'), {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId || undefined }),
    });
  }

  async renameCollection(
    collectionId: string,
    name: string,
    projectId?: string | number | null,
  ): Promise<DashboardCollection> {
    return await fetchApi<DashboardCollection>(
      scopedPath(projectId, `/collections/${collectionId}`),
      { method: 'PUT', body: JSON.stringify({ name }) },
    );
  }

  async deleteCollection(collectionId: string, projectId?: string | number | null): Promise<void> {
    await fetchApi(scopedPath(projectId, `/collections/${collectionId}`), {
      method: 'DELETE',
    });
  }

  async touch(dashboardId: string): Promise<DashboardLibraryItem> {
    return await fetchApi<DashboardLibraryItem>(`dashboards/${dashboardId}/touch`, {
      method: 'POST',
    });
  }

  async setFavorite(dashboardId: string, isFavorite: boolean): Promise<DashboardLibraryItem> {
    return await fetchApi<DashboardLibraryItem>(`dashboards/${dashboardId}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ isFavorite }),
    });
  }

  async assignCollection(
    dashboardId: string,
    collectionId: string | null,
  ): Promise<DashboardLibraryItem> {
    return await fetchApi<DashboardLibraryItem>(`dashboards/${dashboardId}`, {
      method: 'PUT',
      body: JSON.stringify({ collectionId }),
    });
  }

  async restore(dashboardId: string): Promise<DashboardLibraryItem> {
    return await fetchApi<DashboardLibraryItem>(`dashboards/${dashboardId}/restore`, {
      method: 'POST',
    });
  }

  async purge(dashboardId: string): Promise<void> {
    await fetchApi(`dashboards/${dashboardId}?purge=true`, { method: 'DELETE' });
  }
}

export const dashboardLibraryService = new DashboardLibraryServiceClient();
