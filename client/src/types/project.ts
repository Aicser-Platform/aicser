
export interface Project {
    id: string;
    name: string;
    description?: string;
    organization_id: string;
    created_by: string;
    is_active: boolean;
    is_public?: boolean;
    is_private?: boolean;
    owner_name?: string;
    is_shared?: boolean;
    created_at: string;
    updated_at: string;
    settings?: Record<string, any>;
}

export interface CreateProjectPayload {
    name: string;
    description?: string;
    organization_id?: string;
    is_public?: boolean;
    settings?: Record<string, any>;
}

export interface UpdateProjectPayload {
    name?: string;
    description?: string;
    is_public?: boolean;
    is_active?: boolean;
}
// ── Project member management ─────────────────────────────────────────────────

export interface ProjectMember {
    user_id: string;
    email: string;
    full_name?: string | null;
    avatar_url?: string | null;
    role_id: string;
    role_name: string;
    role_display_name: string;
    assigned_at?: string | null;
    assigned_by?: string | null;
}

export interface ProjectMemberListResponse {
    members: ProjectMember[];
    total: number;
    page: number;
    page_size: number;
}

export interface ProjectInvitePayload {
    user_id: string;
    role_id: string;
}

export interface ProjectInviteResponse {
    project_id: string;
    organization_id: string;
    user_id: string;
    role_id: string;
    role_name: string;
    message: string;
}