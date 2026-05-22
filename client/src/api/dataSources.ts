import { fetchApi } from '@/utils/api';
import type { DataSource, SchemaInfo } from '@/stores/useDataSourceStore';

const normalizeSchema = (schema: any): SchemaInfo => {
  if (!schema || typeof schema !== 'object') {
    return { tables: [], schemas: [] };
  }

  const rawTables = Array.isArray(schema.tables)
    ? schema.tables
    : Array.isArray(schema.columns)
      ? [{ name: 'data', columns: schema.columns, row_count: schema.row_count }]
      : [];

  const tables = rawTables.map((table: any) => ({
    ...table,
    name: table?.name || 'data',
    schema: table?.schema,
    rowCount: table?.rowCount ?? table?.row_count ?? null,
    columns: Array.isArray(table?.columns)
      ? table.columns.map((column: any) => ({
          ...column,
          name: column?.name || '',
          type: column?.type || 'string',
          nullable: column?.nullable ?? true,
        }))
      : [],
  }));

  const schemas = Array.isArray(schema.schemas)
    ? schema.schemas
    : Array.from(new Set(tables.map((table: any) => table.schema).filter(Boolean)));

  return {
    ...schema,
    tables,
    schemas,
  };
};

export const listDataSources = (projectId?: string): Promise<{ data_sources: DataSource[] }> =>
  fetchApi(projectId ? `/data/sources?project_id=${projectId}` : '/data/sources').then((res) => ({
    ...res,
    data_sources: Array.isArray(res?.data_sources) ? res.data_sources : [],
  }));

export const getDataSource = (id: string): Promise<DataSource> =>
  fetchApi(`/data/sources/${id}`).then((res) => res?.data_source ?? res);

export const uploadDataSource = (
  file: File,
  options: {
    name?: string;
    project_id?: string;
    include_preview?: boolean;
    delimiter?: string;
    header_row?: number | null;
    sheet_name?: string;
  } = {}
): Promise<{ data_source: DataSource }> => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (options.name) formData.append('name', options.name);
  if (options.project_id) formData.append('project_id', options.project_id);
  if (options.include_preview !== undefined) formData.append('include_preview', String(options.include_preview));
  if (options.delimiter) formData.append('delimiter', options.delimiter);
  if (options.header_row !== null && options.header_row !== undefined) {
    formData.append('header_row', String(options.header_row));
  }
  if (options.sheet_name) formData.append('sheet_name', options.sheet_name);

  return fetchApi('/data/upload', { method: 'POST', body: formData });
};

export const createDataSource = (data: Partial<DataSource> | FormData): Promise<{ data_source: DataSource }> => {
  if (data instanceof FormData) {
    return fetchApi('/data/upload', { method: 'POST', body: data });
  }
  if (data.type === 'file') {
    throw new Error('File data sources must be created with uploadDataSource() or FormData.');
  }
  return fetchApi('/data/database/connect', { method: 'POST', body: JSON.stringify(data) });
};

export const updateDataSource = (id: string, data: Partial<DataSource>): Promise<{ data_source: DataSource }> =>
  fetchApi(`/data/sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteDataSource = (id: string): Promise<void> =>
  fetchApi(`/data/sources/${id}`, { method: 'DELETE' });

export const getDataSourceSchema = (id: string): Promise<{ schema: SchemaInfo }> =>
  fetchApi(`/data/sources/${id}/schema`).then((res) => ({
    ...res,
    schema: normalizeSchema(res?.schema ?? res?.data_source?.schema),
  }));
