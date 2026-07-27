import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/knowledge';
import type { KnowledgeDocument, KnowledgeSearchResponse } from '@/api/knowledge';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  documents: (dataSourceId?: string) =>
    ['knowledge', 'documents', dataSourceId ?? null] as const,
  document: (docId: string) => ['knowledge', 'document', docId] as const,
  search: (query: string, dataSourceId: string) =>
    ['knowledge', 'search', dataSourceId, query] as const,
};

export const useKnowledgeDocuments = (dataSourceId?: string) => {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: knowledgeKeys.documents(dataSourceId),
    queryFn: () => api.listKnowledgeDocuments(dataSourceId),
  });
  return {
    documents: (data ?? []) as KnowledgeDocument[],
    error,
    isLoading,
    refetch,
  };
};

export const useKnowledgeDocument = (docId: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: knowledgeKeys.document(docId!),
    queryFn: () => api.getKnowledgeDocument(docId!),
    enabled: !!docId,
  });
  return { document: data ?? null, error, isLoading };
};

export const useDeleteKnowledgeDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.deleteKnowledgeDocument(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
};

export const useUpdateKnowledgeDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      ...body
    }: {
      docId: string;
      filename?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }) => api.updateKnowledgeDocument(docId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
};

export const useSearchKnowledge = () =>
  useMutation({
    mutationFn: (params: {
      query: string;
      data_source_id: string;
      top_k?: number;
    }): Promise<KnowledgeSearchResponse> => api.searchKnowledge(params),
  });

export const useReindexKnowledgeBase = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dataSourceId: string) => api.reindexKnowledgeBase(dataSourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
};

export const useUploadKnowledgeDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dataSourceId }: { file: File; dataSourceId: string }) =>
      api.uploadKnowledgeDocument(file, dataSourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeKeys.all }),
  });
};
