// Role scopes mirror the server-side `role_scope_enum`
export type RoleScope = 'organization' | 'project';

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  scope: RoleScope;
  is_active: boolean;
  is_deleted: boolean;
}

export interface RoleListResponse {
  roles: Role[];
}
