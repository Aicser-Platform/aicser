import { fetchApi } from '@/utils/api';
import type { ChartQuery } from '../../dashboards/services/chartService';
import {
  normalizeProjectId,
  ProjectRequiredError,
} from './chartBuilderService';

const IS_ENTERPRISE_EDITION =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' || process.env.EDITION === 'enterprise';

export type ChartLibraryFacet =
  | 'all'
  | 'recent'
  | 'library'
  | 'on_dashboards'
  | 'favorites'
  | 'trash';

export type ChartCollection = {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
};

export type ChartLibraryItem = {
  id: string;
  title?: string;
  chartType: string;
  dataSourceId?: string | null;
  collectionId?: string | null;
  isFavorite?: boolean;
  lastOpenedAt?: string | null;
  tags?: string[];
  updatedAt?: string | null;
  usageCount?: number;
  dashboards?: Array<{ id: string; name: string }>;
  scope?: 'library' | 'placed';
  chartQuery?: ChartQuery | Record<string, unknown>;
  chartOptions?: Record<string, unknown>;
  userId?: string | null;
  projectId?: string | null;
};

export type ChartLibraryListResult = {
  charts: ChartLibraryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

function scopedChartPath(projectId?: string | number | null, suffix = ''): string {
  const pid = normalizeProjectId(projectId);
  if (IS_ENTERPRISE_EDITION && !pid) throw new ProjectRequiredError();
  const base = pid ? `chart?project_id=${encodeURIComponent(pid)}` : 'chart';
  if (!suffix) return base;
  // suffix like "/collections" or "?q=..." — when project already in query, append with &
  if (suffix.startsWith('?')) {
    return pid ? `chart${suffix}&project_id=${encodeURIComponent(pid)}` : `chart${suffix}`;
  }
  if (suffix.startsWith('/')) {
    return pid
      ? `chart${suffix}${suffix.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(pid)}`
      : `chart${suffix}`;
  }
  return base;
}

class ChartLibraryServiceClient {
  async list(
    opts: {
      projectId?: string | number | null;
      q?: string;
      facet?: ChartLibraryFacet;
      collectionId?: string | null;
      dataSourceId?: string | null;
      limit?: number;
      offset?: number;
      detail?: 'summary' | 'full';
    } = {},
  ): Promise<ChartLibraryListResult> {
    const params = new URLSearchParams();
    const pid = normalizeProjectId(opts.projectId);
    if (IS_ENTERPRISE_EDITION) {
      if (!pid) throw new ProjectRequiredError();
      params.set('project_id', pid);
    }
    if (opts.q) params.set('q', opts.q);
    if (opts.facet) params.set('facet', opts.facet);
    if (opts.collectionId) params.set('collection_id', opts.collectionId);
    if (opts.dataSourceId) params.set('data_source_id', opts.dataSourceId);
    params.set('limit', String(opts.limit ?? 50));
    params.set('offset', String(opts.offset ?? 0));
    params.set('detail', opts.detail ?? 'summary');
    const data = await fetchApi<{
      charts?: ChartLibraryItem[];
      total?: number;
      limit?: number;
      offset?: number;
      hasMore?: boolean;
    }>(`chart?${params.toString()}`);
    return {
      charts: Array.isArray(data?.charts) ? data.charts : [],
      total: Number(data?.total ?? 0),
      limit: Number(data?.limit ?? opts.limit ?? 50),
      offset: Number(data?.offset ?? opts.offset ?? 0),
      hasMore: Boolean(data?.hasMore),
    };
  }

  async listCollections(projectId?: string | number | null): Promise<ChartCollection[]> {
    const data = await fetchApi<{ collections?: ChartCollection[] }>(
      scopedChartPath(projectId, '/collections'),
    );
    return Array.isArray(data?.collections) ? data.collections : [];
  }

  async createCollection(
    name: string,
    projectId?: string | number | null,
    parentId?: string | null,
  ): Promise<ChartCollection> {
    return await fetchApi<ChartCollection>(scopedChartPath(projectId, '/collections'), {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId || undefined }),
    });
  }

  async renameCollection(
    collectionId: string,
    name: string,
    projectId?: string | number | null,
  ): Promise<ChartCollection> {
    return await fetchApi<ChartCollection>(
      scopedChartPath(projectId, `/collections/${collectionId}`),
      { method: 'PUT', body: JSON.stringify({ name }) },
    );
  }

  async deleteCollection(collectionId: string, projectId?: string | number | null): Promise<void> {
    await fetchApi(scopedChartPath(projectId, `/collections/${collectionId}`), {
      method: 'DELETE',
    });
  }

  async touch(chartId: string): Promise<ChartLibraryItem> {
    return await fetchApi<ChartLibraryItem>(`chart/${chartId}/touch`, { method: 'POST' });
  }

  async setFavorite(chartId: string, isFavorite: boolean): Promise<ChartLibraryItem> {
    return await fetchApi<ChartLibraryItem>(`chart/${chartId}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ isFavorite }),
    });
  }

  async assignCollection(
    chartId: string,
    collectionId: string | null,
  ): Promise<ChartLibraryItem> {
    return await fetchApi<ChartLibraryItem>(`chart/${chartId}`, {
      method: 'PUT',
      body: JSON.stringify({ collectionId }),
    });
  }

  async restore(chartId: string): Promise<ChartLibraryItem> {
    return await fetchApi<ChartLibraryItem>(`chart/${chartId}/restore`, { method: 'POST' });
  }

  async purge(chartId: string): Promise<void> {
    await fetchApi(`chart/${chartId}?purge=true`, { method: 'DELETE' });
  }
}

export const chartLibraryService = new ChartLibraryServiceClient();
