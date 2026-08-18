import { useQuery } from '@tanstack/react-query';

import { listOrganizationMembers } from '@/api/organizations';

export const organizationMemberKeys = {
  members: (orgId: string | null | undefined) => ['organizations', orgId ?? null, 'members'] as const,
};

export const useOrganizationMembers = (orgId: string | null | undefined, enabled = true) => {
  const { data, error, isLoading } = useQuery({
    queryKey: organizationMemberKeys.members(orgId),
    queryFn: () => listOrganizationMembers(orgId!),
    enabled: Boolean(orgId && enabled),
    staleTime: 60_000,
  });

  return { members: data?.members ?? [], error, isLoading: enabled ? isLoading : false };
};
