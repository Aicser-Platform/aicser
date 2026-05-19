export enum RoleScope {
    ORGANIZATION = 'organization',
    PROJECT = 'project',
}

export interface Permission {
    id: string;
    code: string;
    action: string;
    resource: string;
    description: string;
}

export interface Role {
    id: string;
    name: string;
    displayName: string;
    scope: RoleScope;
    description: string;
    permissionCodes: string[];
}

export interface User {
    id: string;
    username: string;
    email: string;
    jobTitle?: string;
    company?: string;
    location?: string;
    bio?: string;
    timezone?: string;
}

export interface Organization {
    id: string;
    name: string;
    createdAt: string;
}

export interface Project {
    id: string | number;
    organizationId: string | number;
    name: string;
    description?: string;
    createdAt: string;
    createdBy: string;
    isPersonal?: boolean;
    is_active?: boolean; // Keep for backward compat if needed, or map
    settings?: Record<string, any>;
}

export interface UserRole {
    id: string;
    userId: string;
    roleId: string;
    organizationId?: string;
    projectId?: string;
}

export interface DataSource {
    id: string;
    projectId: string | number;
    name: string;
    type: string;
    status: string;
    createdAt: string;
    createdBy: string;
    rows: number;
    size: string;
    lastUsed: string;
}

export interface Dashboard {
    id: string;
    projectId: string | number;
    name: string;
    description?: string;
    config: Record<string, any>;
    createdAt: string;
    charts: any[]; // Using any for brevity as Chart type wasn't fully detailed in prompt import
}
