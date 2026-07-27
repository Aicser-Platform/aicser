export interface Organization {
    id: string;
    name: string;
    description?: string;
    logo_url?: string | null;
    settings?: {
        branding?: {
            logo_url?: string | null;
            app_name?: string | null;
        };
    } | null;
    created_at: string;
    updated_at?: string;
    is_active: boolean;
    is_deleted: boolean;
    telegram_enabled: boolean;
    icon_emoji?: string | null;
    color?: string | null;
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
    name?: string;
    description?: string;
    is_active?: boolean;
    is_deleted?: boolean;
    telegram_enabled?: boolean;
    icon_emoji?: string | null;
    color?: string | null;
}

export interface DeleteOrganizationPayload {
    id: string;
}

