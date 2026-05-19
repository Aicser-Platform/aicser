import { fetchApi } from '@/utils/api';
import type {
  Organization,
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from '@/types/organization.type';

export type { Organization, CreateOrganizationPayload, UpdateOrganizationPayload };

export const listOrganizations = (): Promise<{ organizations: Organization[] }> =>
  fetchApi('/organizations');

export const createOrganization = (data: CreateOrganizationPayload): Promise<Organization> =>
  fetchApi('/organizations', { method: 'POST', body: JSON.stringify(data) });

export const updateOrganization = (
  id: string,
  data: UpdateOrganizationPayload,
): Promise<Organization> =>
  fetchApi(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteOrganization = (id: string): Promise<void> =>
  fetchApi(`/organizations/${id}`, { method: 'DELETE' });
