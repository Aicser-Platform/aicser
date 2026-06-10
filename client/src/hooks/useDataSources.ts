import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/dataSources';
import type { DataSource } from '@/stores/useDataSourceStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  dataSourceKeys,
  isEnterpriseEdition,
  resolveDataSourceProjectId,
} from '@/hooks/dataSourceKeys';

export type UseDataSourcesOptions = {
  /** EE only: list sources from all projects the user can access (e.g. semantic layer hub). */
  allProjects?: boolean;
};

export { dataSourceKeys } from '@/hooks/dataSourceKeys';

export const useDataSources = (
  projectId?: string | null,
  options?: UseDataSourcesOptions
) => {
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const effectiveProjectId = useMemo(
    () => resolveDataSourceProjectId(projectId, currentProjectId, options?.allProjects),
    [projectId, currentProjectId, options?.allProjects]
  );

  const { data, error, isLoading } = useQuery({
    queryKey: dataSourceKeys.list(effectiveProjectId ?? null),
    queryFn: () => api.listDataSources(effectiveProjectId),
    enabled: Boolean(options?.allProjects || !isEnterpriseEdition || effectiveProjectId),
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
