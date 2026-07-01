import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listRelationships,
  createRelationship,
  updateRelationship,
  deleteRelationship,
  type DataModelRelationship,
  type RelationshipCreatePayload,
  type RelationshipUpdatePayload,
} from '@/api/dataModel';

const QUERY_KEY = (dataSourceId: string) => ['data-model-relationships', dataSourceId] as const;

export function useRelationships(dataSourceId: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEY(dataSourceId || ''),
    queryFn: () => listRelationships(dataSourceId!),
    enabled: Boolean(dataSourceId),
    staleTime: 30_000,
  });
}

export function useCreateRelationship(dataSourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RelationshipCreatePayload) => createRelationship(dataSourceId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY(dataSourceId) });
    },
  });
}

export function useUpdateRelationship(dataSourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RelationshipUpdatePayload }) =>
      updateRelationship(dataSourceId, id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY(dataSourceId) });
      const prev = qc.getQueryData<DataModelRelationship[]>(QUERY_KEY(dataSourceId));
      qc.setQueryData<DataModelRelationship[]>(QUERY_KEY(dataSourceId), (old) =>
        old ? old.map((r) => (r.id === id ? { ...r, ...payload } : r)) : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY(dataSourceId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY(dataSourceId) });
    },
  });
}

export function useDeleteRelationship(dataSourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRelationship(dataSourceId, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY(dataSourceId) });
      const prev = qc.getQueryData<DataModelRelationship[]>(QUERY_KEY(dataSourceId));
      qc.setQueryData<DataModelRelationship[]>(QUERY_KEY(dataSourceId), (old) =>
        old ? old.filter((r) => r.id !== id) : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY(dataSourceId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY(dataSourceId) });
    },
  });
}
