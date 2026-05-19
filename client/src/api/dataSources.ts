import { fetchApi } from '@/utils/api';
import type { DataSource, SchemaInfo } from '@/stores/useDataSourceStore';

export const listDataSources = (projectId?: string): Promise<{ data_sources: DataSource[] }> =>
  fetchApi(projectId ? `/data/sources?project_id=${projectId}` : '/data/sources');

export const getDataSource = (id: string): Promise<DataSource> =>
  fetchApi(`/data/sources/${id}`);

export const createDataSource = (data: Partial<DataSource>): Promise<{ data_source: DataSource }> => {
  const endpoint = data.type === 'file' ? '/data/upload' : '/data/database/connect';
  return fetchApi(endpoint, { method: 'POST', body: JSON.stringify(data) });
};

export const updateDataSource = (id: string, data: Partial<DataSource>): Promise<{ data_source: DataSource }> =>
  fetchApi(`/data/sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteDataSource = (id: string): Promise<void> =>
  fetchApi(`/data/sources/${id}`, { method: 'DELETE' });

export const getDataSourceSchema = (id: string): Promise<{ schema: SchemaInfo }> =>
  fetchApi(`/data/sources/${id}/schema`);
