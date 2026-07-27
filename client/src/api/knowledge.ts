import { fetchApi } from '@/utils/api';

export interface KnowledgeDocument {
  id: string;
  data_source_id: string;
  filename: string;
  file_type?: string | null;
  chunk_count: number;
  status: string;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown> | null;
  document_filename?: string | null;
}

export interface KnowledgeSearchResponse {
  success: boolean;
  query: string;
  results: RetrievedChunk[];
  total: number;
}

export const listKnowledgeDocuments = (
  dataSourceId?: string,
): Promise<KnowledgeDocument[]> => {
  const qs = dataSourceId
    ? `?data_source_id=${encodeURIComponent(dataSourceId)}`
    : '';
  return fetchApi(`knowledge/documents${qs}`).then((res) =>
    Array.isArray(res) ? res : [],
  );
};

export const getKnowledgeDocument = (docId: string): Promise<KnowledgeDocument> =>
  fetchApi(`knowledge/documents/${docId}`);

export const deleteKnowledgeDocument = (
  docId: string,
): Promise<{ success: boolean; message?: string }> =>
  fetchApi(`knowledge/documents/${docId}`, { method: 'DELETE' });

export const updateKnowledgeDocument = (
  docId: string,
  body: { filename?: string; description?: string; metadata?: Record<string, unknown> },
): Promise<KnowledgeDocument> =>
  fetchApi(`knowledge/documents/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const searchKnowledge = (params: {
  query: string;
  data_source_id: string;
  top_k?: number;
}): Promise<KnowledgeSearchResponse> =>
  fetchApi('knowledge/search', {
    method: 'POST',
    body: JSON.stringify({
      query: params.query,
      data_source_id: params.data_source_id,
      top_k: params.top_k ?? 5,
    }),
  });

export const reindexKnowledgeBase = (
  dataSourceId: string,
): Promise<{ success: boolean; documents_processed: number; chunks_reindexed: number; message: string }> =>
  fetchApi('knowledge/reindex', {
    method: 'POST',
    body: JSON.stringify({ data_source_id: dataSourceId }),
  });

export const uploadKnowledgeDocument = (
  file: File,
  dataSourceId: string,
): Promise<{ success: boolean; document_id: string; filename: string; status: string; message: string }> => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('data_source_id', dataSourceId);
  return fetchApi('knowledge/upload', { method: 'POST', body: formData });
};

export interface KnowledgeLibrary {
  id: string;
  name: string;
  description?: string | null;
  organization_id: string;
  scope: 'organization' | 'project';
  project_id?: string | null;
  data_source_id: string;
  settings?: Record<string, unknown>;
  document_count?: number;
  ready_document_count?: number;
  is_active?: boolean;
}

export const listKnowledgeLibraries = (params: {
  organization_id: string;
  project_id?: string;
}): Promise<{ libraries: KnowledgeLibrary[] }> =>
  fetchApi(
    `knowledge/libraries?organization_id=${encodeURIComponent(params.organization_id)}${
      params.project_id ? `&project_id=${encodeURIComponent(params.project_id)}` : ''
    }`,
  );

export const createKnowledgeLibrary = (body: {
  name: string;
  description?: string;
  organization_id: string;
  scope?: 'organization' | 'project';
  project_id?: string;
}): Promise<KnowledgeLibrary> =>
  fetchApi('knowledge/libraries', { method: 'POST', body: JSON.stringify(body) });

export const updateKnowledgeLibrary = (
  libraryId: string,
  body: Partial<{ name: string; description: string; settings: Record<string, unknown>; is_active: boolean }>,
): Promise<KnowledgeLibrary> =>
  fetchApi(`knowledge/libraries/${libraryId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteKnowledgeLibrary = (libraryId: string): Promise<void> =>
  fetchApi(`knowledge/libraries/${libraryId}`, { method: 'DELETE' });

export const backfillKnowledgeLibraries = (organizationId: string): Promise<{ created: number }> =>
  fetchApi(`knowledge/libraries/backfill-legacy?organization_id=${encodeURIComponent(organizationId)}`, {
    method: 'POST',
  });
