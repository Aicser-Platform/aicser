import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/projects';
import type { Project, ProjectInvitePayload } from '@/api/projects';

export const projectKeys = {
  all: ['projects'] as const,
  list: (orgId: string | null | undefined) => ['projects', 'list', orgId ?? null] as const,
  detail: (id: string | number) => ['projects', String(id)] as const,
  members: (id: string) => ['projects', id, 'members'] as const,
};

export const useProjects = (organizationId: string | null | undefined) => {
  const { data, error, isLoading } = useQuery({
    queryKey: projectKeys.list(organizationId),
    queryFn: () => api.listProjects(organizationId!),
    enabled: !!organizationId,
    select: (res) => res.projects,
  });
  return { projects: data ?? [], error, isLoading };
};

export const useProjectMembers = (projectId: string | null | undefined) => {
  const { data, error, isLoading } = useQuery({
    queryKey: projectKeys.members(projectId!),
    queryFn: () => api.listProjectMembers(projectId!),
    enabled: !!projectId,
  });
  return {
    members: data?.members ?? [],
    total: data?.total ?? 0,
    error,
    isLoading,
  };
};

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Project>) => api.createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
};

export const useUpdateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string | number; data: Partial<Project> }) =>
      api.updateProject(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
};

export const useDeleteProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
};

export const useInviteProjectMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: ProjectInvitePayload }) =>
      api.inviteProjectMember(projectId, payload),
    onSuccess: (_res, { projectId }) =>
      qc.invalidateQueries({ queryKey: projectKeys.members(projectId) }),
  });
};

export const useUpdateProjectMemberRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      userId,
      roleId,
    }: {
      projectId: string;
      userId: string;
      roleId: string;
    }) => api.updateProjectMemberRole(projectId, userId, roleId),
    onSuccess: (_res, { projectId }) =>
      qc.invalidateQueries({ queryKey: projectKeys.members(projectId) }),
  });
};

export const useRemoveProjectMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      api.removeProjectMember(projectId, userId),
    onSuccess: (_res, { projectId }) =>
      qc.invalidateQueries({ queryKey: projectKeys.members(projectId) }),
  });
};
