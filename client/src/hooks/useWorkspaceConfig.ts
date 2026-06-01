import { useQuery } from '@tanstack/react-query';
import { getWorkspaceConfig } from '@/api/organizations';

export const workspaceConfigKeys = {
  all: ['workspace-config'] as const,
};

export function useWorkspaceConfig(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const { data, isLoading } = useQuery({
    queryKey: workspaceConfigKeys.all,
    queryFn: getWorkspaceConfig,
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    // Non-blocking: header/settings use defaults if proxy route is unavailable
    placeholderData: {
      mode: 'saas' as const,
      allows_multi_org: true,
      allows_create_org: true,
      default_org_name: 'Organization',
      single_org_rename_only: false,
    },
  });
  return {
    config: data,
    isLoading: enabled ? isLoading : false,
    allowsCreateOrg: data?.allows_create_org ?? true,
    isSelfHost: data?.mode === 'self_host',
  };
}
