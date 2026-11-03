'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pluginService,
  type ActivePluginsPayload,
  type ActiveVisualMeta,
  type PluginStateItem,
} from '@/services/pluginService';

export type { ActiveVisualMeta, ActivePluginsPayload, PluginStateItem };

export function useActivePlugins() {
  return useQuery<ActivePluginsPayload>({
    queryKey: ['plugins', 'active'],
    queryFn: () => pluginService.getActivePlugins(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useAdminPlugins(enabled = true) {
  return useQuery<PluginStateItem[]>({
    queryKey: ['plugins', 'admin'],
    queryFn: () => pluginService.getAllPlugins(),
    enabled,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTogglePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      enabled,
      config,
    }: {
      id: string;
      enabled: boolean;
      config?: Record<string, any>;
    }) => pluginService.updateEnablement(id, enabled, config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'active'] });
    },
  });
}

