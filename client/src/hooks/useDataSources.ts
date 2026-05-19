import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/dataSources';
import type { DataSource } from '@/stores/useDataSourceStore';

// ── Cache keys ────────────────────────────────────────────────────────────────

export const dataSourceKeys = {
  all: ['data-sources'] as const,
  list: (projectId?: string) => ['data-sources', 'list', projectId ?? null] as const,
  detail: (id: string) => ['data-sources', id] as const,
  schema: (id: string) => ['data-sources', id, 'schema'] as const,
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export const useDataSources = (projectId?: string) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dataSourceKeys.list(projectId),
    queryFn: () => api.listDataSources(projectId),
    select: (res) => res?.data_sources ?? [],
  });
  return { dataSources: data ?? [], error, isLoading };
};

export const useDataSource = (id: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dataSourceKeys.detail(id!),
    queryFn: () => api.getDataSource(id!),
    enabled: !!id,
  });
  return { dataSource: data ?? null, error, isLoading };
};

export const useDataSourceSchema = (id: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dataSourceKeys.schema(id!),
    queryFn: () => api.getDataSourceSchema(id!),
    enabled: !!id,
    select: (res) => res.schema,
  });
  return { schema: data ?? null, error, isLoading };
};

// ── Mutations ─────────────────────────────────────────────────────────────────

export const useCreateDataSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<DataSource>) => api.createDataSource(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataSourceKeys.all }),
  });
};

export const useUpdateDataSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DataSource> }) =>
      api.updateDataSource(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.all });
      qc.invalidateQueries({ queryKey: dataSourceKeys.detail(id) });
    },
  });
};

export const useDeleteDataSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataSourceKeys.all }),
  });
};
