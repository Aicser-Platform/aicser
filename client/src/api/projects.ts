import { fetchApi } from '@/utils/api';
import type {
  Project,
  ProjectMember,
  ProjectMemberListResponse,
  ProjectInvitePayload,
  ProjectInviteResponse,
} from '@/types/project';

export type { Project, ProjectMember, ProjectMemberListResponse, ProjectInvitePayload, ProjectInviteResponse };

export const listProjects = (organizationId: string): Promise<{ projects: Project[] }> =>
  fetchApi(`/projects/organization/${organizationId}`);

export const createProject = (data: Partial<Project>): Promise<Project> =>
  fetchApi('/projects', { method: 'POST', body: JSON.stringify(data) });

export const updateProject = (id: string | number, data: Partial<Project>): Promise<Project> =>
  fetchApi(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteProject = (id: string | number): Promise<void> =>
  fetchApi(`/projects/${id}`, { method: 'DELETE' });

export const listProjectMembers = (
  projectId: string,
  page = 1,
  pageSize = 50,
): Promise<ProjectMemberListResponse> =>
  fetchApi(`/projects/${projectId}/members?page=${page}&page_size=${pageSize}`);

export const inviteProjectMember = (
  projectId: string,
  payload: ProjectInvitePayload,
): Promise<ProjectInviteResponse> =>
  fetchApi(`/projects/${projectId}/invite`, { method: 'POST', body: JSON.stringify(payload) });

export const updateProjectMemberRole = (
  projectId: string,
  userId: string,
  roleId: string,
): Promise<ProjectInviteResponse> =>
  fetchApi(`/projects/${projectId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role_id: roleId }),
  });

export const removeProjectMember = (projectId: string, userId: string): Promise<void> =>
  fetchApi(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
