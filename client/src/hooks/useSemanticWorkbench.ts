'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  draftYamlFiles,
  createYamlPath,
  getSemanticContext,
  getYamlFiles,
  runSemanticQuery,
  saveYamlFile,
  syncYaml,
  getSemanticLineage,
  upsertSemanticMember,
  validateYaml,
} from '@/api/semanticWorkbench';
import type { SemanticQueryRequest, UpsertMemberRequest } from '@/types/semanticWorkbench';

const contextKey = (dataSourceId: string) => ['semantic-context', dataSourceId];
const yamlKey = (dataSourceId: string) => ['semantic-yaml', dataSourceId];
const lineageKey = (dataSourceId: string) => ['semantic-lineage', dataSourceId];

export function useSemanticContext(dataSourceId: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: [...contextKey(dataSourceId || ''), projectId || ''],
    queryFn: () => getSemanticContext(dataSourceId as string, projectId),
    enabled: Boolean(dataSourceId),
    staleTime: 30_000,
  });
}

export function useRunSemanticQuery() {
  return useMutation({
    mutationFn: (body: SemanticQueryRequest) => runSemanticQuery(body),
  });
}

export function useYamlFiles(dataSourceId: string | undefined) {
  return useQuery({
    queryKey: yamlKey(dataSourceId || ''),
    queryFn: () => getYamlFiles(dataSourceId as string),
    enabled: Boolean(dataSourceId),
    retry: false, // 404 = no YAML directory yet; the tab offers drafting instead
  });
}

export function useSaveYamlFile(dataSourceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      saveYamlFile(path, content),
    onSuccess: () => {
      if (dataSourceId) {
        void queryClient.invalidateQueries({ queryKey: yamlKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: contextKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: lineageKey(dataSourceId) });
      }
    },
  });
}

export function useCreateYamlPath(dataSourceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, kind, content }: { path: string; kind: 'file' | 'folder'; content?: string }) =>
      createYamlPath(path, kind, content),
    onSuccess: () => {
      if (dataSourceId) {
        void queryClient.invalidateQueries({ queryKey: yamlKey(dataSourceId) });
      }
    },
  });
}

export function useSyncYaml(dataSourceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceDir: string) => syncYaml(sourceDir),
    onSuccess: () => {
      if (dataSourceId) {
        void queryClient.invalidateQueries({ queryKey: yamlKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: contextKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: lineageKey(dataSourceId) });
      }
    },
  });
}

export function useDraftYamlFiles(dataSourceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => draftYamlFiles(dataSourceId as string),
    onSuccess: () => {
      if (dataSourceId) {
        void queryClient.invalidateQueries({ queryKey: yamlKey(dataSourceId) });
      }
    },
  });
}

export function useSemanticLineage(dataSourceId: string | undefined) {
  return useQuery({
    queryKey: lineageKey(dataSourceId || ''),
    queryFn: () => getSemanticLineage(dataSourceId as string),
    enabled: Boolean(dataSourceId),
    retry: false, // 404 = no YAML directory yet
  });
}

export function useUpsertMember(dataSourceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertMemberRequest) => upsertSemanticMember(body),
    onSuccess: (res) => {
      if (dataSourceId && res.success) {
        void queryClient.invalidateQueries({ queryKey: yamlKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: contextKey(dataSourceId) });
        void queryClient.invalidateQueries({ queryKey: lineageKey(dataSourceId) });
      }
    },
  });
}

export function useValidateYaml() {
  return useMutation({ mutationFn: () => validateYaml() });
}
