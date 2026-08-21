import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/dataSources';
import { ApiError } from '@/utils/api';
import type { DataSource } from '@/stores/useDataSourceStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { dataSourceKeys, isEnterpriseEdition, resolveDataSourceProjectId } from '@/hooks/dataSourceKeys';

export type UseDataSourcesOptions = {
  /** EE only: list sources from all projects the user can access (e.g. semantic layer hub). */
  allProjects?: boolean;
};

export { dataSourceKeys } from '@/hooks/dataSourceKeys';

export const useDataSources = (projectId?: string | null, options?: UseDataSourcesOptions) => {
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
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
    select: (res) => res.schema,
  });
  return { schema: data ?? null, error, isLoading };
};

export const useDataSourceAccessGrants = (id: string | null, enabled = true) => {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: id ? dataSourceKeys.accessGrants(id) : dataSourceKeys.accessGrants(''),
    queryFn: () => api.listDataSourceAccessGrants(id!),
    enabled: Boolean(id && enabled && isEnterpriseEdition),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
    select: (res) => res.grants ?? [],
  });
  return { grants: data ?? [], error, isLoading, isFetching };
};

export const useDataSourceRLSPolicies = (id: string | null, enabled = true) => {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: id ? dataSourceKeys.rlsPolicies(id) : dataSourceKeys.rlsPolicies(''),
    queryFn: () => api.listDataSourceRLSPolicies(id!),
    enabled: Boolean(id && enabled && isEnterpriseEdition),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
    select: (res) => res.policies ?? [],
  });
  return { policies: data ?? [], error, isLoading, isFetching };
};

export const useDataSourceCLSPolicies = (id: string | null, enabled = true) => {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: id ? dataSourceKeys.clsPolicies(id) : dataSourceKeys.clsPolicies(''),
    queryFn: () => api.listDataSourceCLSPolicies(id!),
    enabled: Boolean(id && enabled && isEnterpriseEdition),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
    select: (res) => res.policies ?? [],
  });
  return { policies: data ?? [], error, isLoading, isFetching };
};

/**
 * Caller-scoped row access: the AUTHENTICATED caller's own effective RLS
 * policies, gated on QUERY permission (not MANAGE/SHARE), so a query-only
 * user can learn why their own results were filtered.
 */
export const useDataSourceMyRowAccess = (id: string | null, enabled = true) => {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: id ? dataSourceKeys.myRowAccess(id) : dataSourceKeys.myRowAccess(''),
    queryFn: () => api.getDataSourceMyRowAccess(id!),
    enabled: Boolean(id && enabled && isEnterpriseEdition),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
  });
  return { myRowAccess: data ?? null, error, isLoading, isFetching };
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
    mutationFn: ({ id, data }: { id: string; data: Partial<DataSource> }) => api.updateDataSource(id, data),
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

export const useUpsertDataSourceAccessGrant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.DataSourceAccessGrantRequest }) =>
      api.upsertDataSourceAccessGrant(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.list(null) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.myRowAccess(id) });
    },
  });
};

export const useRevokeDataSourceAccessGrant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, grantId }: { id: string; grantId: string }) => api.revokeDataSourceAccessGrant(id, grantId),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.list(null) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.myRowAccess(id) });
    },
  });
};

export const useCreateDataSourceRLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.DataSourceRLSPolicyRequest }) =>
      api.createDataSourceRLSPolicy(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.rlsPolicies(id) });
    },
  });
};

export const useUpdateDataSourceRLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, policyId, data }: { id: string; policyId: string; data: api.DataSourceRLSPolicyRequest }) =>
      api.updateDataSourceRLSPolicy(id, policyId, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.rlsPolicies(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
    },
  });
};

export const useDeleteDataSourceRLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, policyId }: { id: string; policyId: string }) => api.deleteDataSourceRLSPolicy(id, policyId),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.rlsPolicies(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
    },
  });
};

export const useCreateDataSourceCLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.DataSourceCLSPolicyRequest }) =>
      api.createDataSourceCLSPolicy(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.clsPolicies(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.myRowAccess(id) });
    },
  });
};

export const useUpdateDataSourceCLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, policyId, data }: { id: string; policyId: string; data: api.DataSourceCLSPolicyRequest }) =>
      api.updateDataSourceCLSPolicy(id, policyId, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.clsPolicies(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.myRowAccess(id) });
    },
  });
};

export const useDeleteDataSourceCLSPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, policyId }: { id: string; policyId: string }) => api.deleteDataSourceCLSPolicy(id, policyId),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.clsPolicies(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.accessGrants(id) });
      qc.invalidateQueries({ queryKey: dataSourceKeys.myRowAccess(id) });
    },
  });
};

export const useSuggestDataSourceCLSPolicy = () =>
  useMutation({
    mutationFn: ({ id }: { id: string }) => api.suggestDataSourceCLSPolicy(id),
  });

export const usePreviewDataSourceRLSPolicy = () =>
  useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.DataSourceRLSPreviewRequest }) =>
      api.previewDataSourceRLSPolicy(id, data),
  });

export const useDataSourceRLSProjectAttributes = (
  id: string | null,
  projectId: string | null | undefined,
  enabled = true
) => {
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: id ? dataSourceKeys.rlsProjectAttributes(id, projectId) : dataSourceKeys.rlsProjectAttributes(''),
    queryFn: () => api.getDataSourceRLSProjectAttributes(id!, projectId!),
    enabled: Boolean(id && projectId && enabled && isEnterpriseEdition),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
        return false;
      }
      return failureCount < 1;
    },
  });
  return {
    attributes: data?.attributes ?? [],
    error,
    isLoading,
    isFetching,
  };
};

export const useUpdateDataSourceRLSProjectAttribute = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      projectId,
      key,
      value,
    }: {
      id: string;
      projectId: string;
      key: string;
      value: unknown;
    }) => api.updateDataSourceRLSProjectAttribute(id, projectId, { key, value }),
    onSuccess: (_res, { id, projectId }) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.rlsProjectAttributes(id, projectId) });
    },
  });
};
