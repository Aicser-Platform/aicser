export interface Organization {
    id: string;
    name: string;
    description?: string;
    created_at: string;
    updated_at?: string;
    is_active: boolean;
    is_deleted: boolean;
    telegram_enabled: boolean;
}

export interface OrganizationWithStats extends Organization {
    project_count: number;
    member_count: number;
}

export interface CreateOrganizationPayload {
    name: string;
    description?: string;
}

export interface UpdateOrganizationPayload {
    id: string;
    name?: string;
    description?: string;
    is_active?: boolean;
    is_deleted?: boolean;
    telegram_enabled?: boolean;
}

export interface DeleteOrganizationPayload {
    id: string;
}

