import { fetchApi } from '@/utils/api';
import type { Organization, CreateOrganizationPayload, UpdateOrganizationPayload } from '@/types/organization.type';

export type { Organization, CreateOrganizationPayload, UpdateOrganizationPayload };

export interface OrganizationMember {
  user_id: string;
  email: string | null;
  username: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export const listOrganizations = (): Promise<{ organizations: Organization[] }> => fetchApi('/organizations');

export const createOrganization = (data: CreateOrganizationPayload): Promise<Organization> =>
  fetchApi('/organizations', { method: 'POST', body: JSON.stringify(data) });

export const updateOrganization = (id: string, data: UpdateOrganizationPayload): Promise<Organization> =>
  fetchApi(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteOrganization = (id: string): Promise<void> => fetchApi(`/organizations/${id}`, { method: 'DELETE' });

export type WorkspaceConfig = {
  mode: 'saas' | 'self_host';
  allows_multi_org: boolean;
  allows_create_org: boolean;
  default_org_name: string;
  single_org_rename_only: boolean;
};

export const getWorkspaceConfig = (): Promise<WorkspaceConfig> => fetchApi('/organizations/workspace-config');

export const listOrganizationMembers = (organizationId: string): Promise<{ members: OrganizationMember[] }> =>
  fetchApi(`/organizations/${organizationId}/members`).then((res) => ({
    members: Array.isArray(res) ? res : (res?.members ?? []),
  }));
