import { fetchApi } from '@/utils/api';
import type {
  SemanticContext,
  SemanticQueryRequest,
  SemanticQueryResult,
  YamlFilesResponse,
  YamlSaveResponse,
  YamlSyncResult,
  SemanticLineage,
  UpsertMemberRequest,
  UpsertMemberResponse,
  YamlCreatePathResponse,
  YamlValidateResponse,
} from '@/types/semanticWorkbench';

export async function runSemanticQuery(
  body: SemanticQueryRequest
): Promise<SemanticQueryResult> {
  return fetchApi<SemanticQueryResult>('semantic/query', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getSemanticContext(
  dataSourceId: string,
  projectId?: string
): Promise<SemanticContext> {
  const q = new URLSearchParams({ data_source_id: dataSourceId });
  if (projectId) q.set('project_id', projectId);
  const res = await fetchApi<{ success: boolean; context: SemanticContext }>(
    `semantic/context?${q.toString()}`
  );
  return res.context;
}

export async function getYamlFiles(dataSourceId: string): Promise<YamlFilesResponse> {
  const q = new URLSearchParams({ data_source_id: dataSourceId });
  return fetchApi<YamlFilesResponse>(`semantic/yaml/files?${q.toString()}`);
}

export async function saveYamlFile(
  path: string,
  content: string
): Promise<YamlSaveResponse> {
  return fetchApi<YamlSaveResponse>('semantic/yaml/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function createYamlPath(
  path: string,
  kind: 'file' | 'folder',
  content = ''
): Promise<YamlCreatePathResponse> {
  return fetchApi<YamlCreatePathResponse>('semantic/yaml/path', {
    method: 'POST',
    body: JSON.stringify({ path, kind, content }),
  });
}

export async function syncYaml(sourceDir: string): Promise<YamlSyncResult> {
  return fetchApi<YamlSyncResult>('semantic/yaml/sync', {
    method: 'POST',
    body: JSON.stringify({ source_dir: sourceDir }),
  });
}

export async function draftYamlFiles(dataSourceId: string): Promise<YamlFilesResponse> {
  return fetchApi<YamlFilesResponse>('semantic/yaml/draft', {
    method: 'POST',
    body: JSON.stringify({ data_source_id: dataSourceId }),
  });
}

export async function getSemanticLineage(dataSourceId: string): Promise<SemanticLineage> {
  const q = new URLSearchParams({ data_source_id: dataSourceId });
  return fetchApi<SemanticLineage>(`semantic/lineage?${q.toString()}`);
}

export async function upsertSemanticMember(
  body: UpsertMemberRequest
): Promise<UpsertMemberResponse> {
  return fetchApi<UpsertMemberResponse>('semantic/yaml/upsert-member', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function validateYaml(): Promise<YamlValidateResponse> {
  return fetchApi<YamlValidateResponse>('semantic/yaml/validate', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
