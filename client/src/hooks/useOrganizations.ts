import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/organizations';
import type { CreateOrganizationPayload, UpdateOrganizationPayload } from '@/api/organizations';
import { useOrganizationStore } from '@/stores/useOrganizationStore';

export const organizationKeys = {
  all: ['organizations'] as const,
  list: () => ['organizations', 'list'] as const,
  detail: (id: string) => ['organizations', id] as const,
};

export const useOrganizations = (options: { enabled?: boolean } = {}) => {
  const enabled = options.enabled ?? true;
  const { data, error, isLoading } = useQuery({
    queryKey: organizationKeys.list(),
    queryFn: api.listOrganizations,
    select: (res) => res.organizations,
    enabled,
  });
  return { organizations: data ?? [], error, isLoading: enabled ? isLoading : false };
};

export const useCreateOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOrganizationPayload) => api.createOrganization(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  });
};

export const useUpdateOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrganizationPayload }) =>
      api.updateOrganization(id, data),
    onSuccess: (updated, variables) => {
      const { currentOrganization, setCurrentOrganization } = useOrganizationStore.getState();
      if (currentOrganization?.id === variables.id) {
        setCurrentOrganization({ ...currentOrganization, ...updated });
      }
      void qc.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
};

export const useDeleteOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteOrganization(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
  });
};
