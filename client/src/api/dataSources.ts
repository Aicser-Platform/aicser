import { fetchApi } from '@/utils/api';
import type { DataSource, SchemaInfo } from '@/stores/useDataSourceStore';

export type DataSourceGrantPermission = 'view' | 'query' | 'edit' | 'manage' | 'share';
export type DataSourceGrantGranteeType = 'project' | 'user' | 'group' | 'org_role' | 'project_role';

export interface DataSourceAccessGrant {
  id: string;
  organization_id?: string | null;
  data_source_id: string;
  grantee_type: DataSourceGrantGranteeType;
  grantee_id: string;
  permissions: DataSourceGrantPermission[];
  rls_policy_id?: string | null;
  created_by?: string | null;
  is_active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DataSourceAccessGrantRequest {
  grantee_type: DataSourceGrantGranteeType;
  grantee_id: string;
  permissions: DataSourceGrantPermission[];
  rls_policy_id?: string | null;
}

export type DataSourceRLSOperator = 'eq' | 'in' | 'not_in' | 'between' | 'is_null' | 'is_not_null';
export type DataSourceRLSValueType =
  | 'fixed'
  | 'user_attribute'
  | 'group_attribute'
  | 'org_attribute'
  | 'project_attribute';

export interface DataSourceRLSRuleRequest {
  table_name: string;
  column_name: string;
  operator: DataSourceRLSOperator;
  value_type: DataSourceRLSValueType;
  value?: unknown;
  sort_order?: number;
}

export interface DataSourceRLSPolicyRequest {
  name: string;
  description?: string | null;
  enabled: boolean;
  default_deny: boolean;
  settings: Record<string, unknown>;
  rules: DataSourceRLSRuleRequest[];
}

export interface DataSourceRLSRule extends DataSourceRLSRuleRequest {
  id: string;
  policy_id: string;
  sort_order: number;
  is_active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DataSourceRLSPolicy {
  id: string;
  organization_id?: string | null;
  data_source_id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  default_deny: boolean;
  settings: Record<string, unknown>;
  created_by?: string | null;
  rules: DataSourceRLSRule[];
  is_active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DataSourceRLSPreviewRequest {
  rules: DataSourceRLSRuleRequest[];
  default_deny: boolean;
  simulate_user_id?: string | null;
  simulate_project_id?: string | null;
}

export interface DataSourceRLSPreviewResponse {
  success: boolean;
  predicate?: string | null;
  dialect: string;
  unresolved: string[];
  effect: 'filtered' | 'deny_all' | 'no_filter';
  masked: boolean;
  error?: string | null;
}

export interface DataSourceRLSAttribute {
  key: string;
  value: unknown;
  value_preview: string;
}

export interface DataSourceRLSAttributesResponse {
  success: boolean;
  project_id: string;
  attributes: DataSourceRLSAttribute[];
}

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

export const deleteDataSource = (id: string): Promise<void> => fetchApi(`/data/sources/${id}`, { method: 'DELETE' });

export const getDataSourceSchema = (id: string): Promise<{ schema: SchemaInfo }> =>
  fetchApi(`/data/sources/${id}/schema`).then((res) => ({
    ...res,
    schema: normalizeSchema(res?.schema ?? res?.data_source?.schema),
  }));

export const listDataSourceAccessGrants = (id: string): Promise<{ grants: DataSourceAccessGrant[]; count: number }> =>
  fetchApi(`/data/sources/${id}/access-grants`).then((res) => ({
    ...res,
    grants: Array.isArray(res?.grants) ? res.grants : [],
    count: Number(res?.count ?? res?.grants?.length ?? 0),
  }));

export const upsertDataSourceAccessGrant = (
  id: string,
  data: DataSourceAccessGrantRequest
): Promise<{ grant: DataSourceAccessGrant }> =>
  fetchApi(`/data/sources/${id}/access-grants`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const revokeDataSourceAccessGrant = (id: string, grantId: string): Promise<void> =>
  fetchApi(`/data/sources/${id}/access-grants/${grantId}`, { method: 'DELETE' });

export const listDataSourceRLSPolicies = (id: string): Promise<{ policies: DataSourceRLSPolicy[]; count: number }> =>
  fetchApi(`/data/sources/${id}/rls-policies`).then((res) => ({
    ...res,
    policies: Array.isArray(res?.policies) ? res.policies : [],
    count: Number(res?.count ?? res?.policies?.length ?? 0),
  }));

export const createDataSourceRLSPolicy = (
  id: string,
  data: DataSourceRLSPolicyRequest
): Promise<{ policy: DataSourceRLSPolicy }> =>
  fetchApi(`/data/sources/${id}/rls-policies`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateDataSourceRLSPolicy = (
  id: string,
  policyId: string,
  data: DataSourceRLSPolicyRequest
): Promise<{ policy: DataSourceRLSPolicy }> =>
  fetchApi(`/data/sources/${id}/rls-policies/${policyId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteDataSourceRLSPolicy = (id: string, policyId: string): Promise<void> =>
  fetchApi(`/data/sources/${id}/rls-policies/${policyId}`, { method: 'DELETE' });

export const previewDataSourceRLSPolicy = (
  id: string,
  data: DataSourceRLSPreviewRequest
): Promise<DataSourceRLSPreviewResponse> =>
  fetchApi(`/data/sources/${id}/rls-policies/preview`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getDataSourceRLSProjectAttributes = (
  id: string,
  projectId: string
): Promise<DataSourceRLSAttributesResponse> =>
  fetchApi(`/data/sources/${id}/rls-attributes/project/${projectId}`).then((res) => ({
    ...res,
    attributes: Array.isArray(res?.attributes) ? res.attributes : [],
  }));

export const updateDataSourceRLSProjectAttribute = (
  id: string,
  projectId: string,
  data: { key: string; value: unknown }
): Promise<DataSourceRLSAttributesResponse> =>
  fetchApi(`/data/sources/${id}/rls-attributes/project/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then((res) => ({
    ...res,
    attributes: Array.isArray(res?.attributes) ? res.attributes : [],
  }));
