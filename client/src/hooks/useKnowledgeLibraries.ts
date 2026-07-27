import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/knowledge';
import type { KnowledgeLibrary } from '@/api/knowledge';

export const libraryKeys = {
  all: ['knowledge-libraries'] as const,
  list: (orgId?: string, projectId?: string) =>
    ['knowledge-libraries', orgId ?? null, projectId ?? null] as const,
};

export const useKnowledgeLibraries = (organizationId?: string, projectId?: string) => {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: libraryKeys.list(organizationId, projectId),
    queryFn: () =>
      api.listKnowledgeLibraries({
        organization_id: organizationId!,
        project_id: projectId,
      }),
    enabled: !!organizationId,
  });
  return {
    libraries: (data?.libraries ?? []) as KnowledgeLibrary[],
    error,
    isLoading,
    refetch,
  };
};

export const useCreateKnowledgeLibrary = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createKnowledgeLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.all }),
  });
};

export const useDeleteKnowledgeLibrary = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteKnowledgeLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.all }),
  });
};

export const useUpdateKnowledgeLibrary = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      libraryId,
      ...body
    }: {
      libraryId: string;
      name?: string;
      description?: string;
      settings?: Record<string, unknown>;
      is_active?: boolean;
    }) => api.updateKnowledgeLibrary(libraryId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.all }),
  });
};

export const useBackfillKnowledgeLibraries = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.backfillKnowledgeLibraries,
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.all }),
  });
};
