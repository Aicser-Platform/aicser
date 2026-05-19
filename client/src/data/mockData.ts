import { Permission, Role, RoleScope, User, Organization, Project, UserRole, DataSource, Dashboard } from '@/types/mock';

// --- MOCK PERMISSIONS ---
export const PERMISSIONS: Permission[] = [
    // Organization
    { id: 'p1', code: 'org:view', action: 'view', resource: 'organization', description: 'View organization details' },
    { id: 'p2', code: 'org:edit', action: 'edit', resource: 'organization', description: 'Edit organization settings' },
    { id: 'p3', code: 'org:delete', action: 'delete', resource: 'organization', description: 'Delete organization' },
    { id: 'p4', code: 'org:manage_users', action: 'manage_users', resource: 'organization', description: 'Manage organization users' },
    { id: 'p5', code: 'org:manage_billing', action: 'manage_billing', resource: 'organization', description: 'Manage billing' },
    // Project
    { id: 'p6', code: 'project:view', action: 'view', resource: 'project', description: 'View project' },
    { id: 'p7', code: 'project:create', action: 'create', resource: 'project', description: 'Create projects' },
    { id: 'p8', code: 'project:edit', action: 'edit', resource: 'project', description: 'Edit project' },
    { id: 'p9', code: 'project:delete', action: 'delete', resource: 'project', description: 'Delete project' },
    { id: 'p10', code: 'project:manage_members', action: 'manage_members', resource: 'project', description: 'Manage project members' },
    // Data, Dashboard, Chart, AI
    { id: 'p11', code: 'data:view', action: 'view', resource: 'data', description: 'View data sources' },
    { id: 'p12', code: 'data:create', action: 'create', resource: 'data', description: 'Create data sources' },
    { id: 'p13', code: 'dashboard:view', action: 'view', resource: 'dashboard', description: 'View dashboards' },
    { id: 'p14', code: 'dashboard:create', action: 'create', resource: 'dashboard', description: 'Create dashboards' },
    { id: 'p15', code: 'dashboard:edit', action: 'edit', resource: 'dashboard', description: 'Edit dashboards' },
    { id: 'p16', code: 'ai:use', action: 'use', resource: 'ai', description: 'Use AI features' },
];

// --- MOCK ROLES ---
export const ROLES: Role[] = [
    // Organization Roles
    {
        id: 'r_org_owner',
        name: 'org_owner',
        displayName: 'Organization Owner',
        scope: RoleScope.ORGANIZATION,
        description: 'Full control over organization',
        permissionCodes: ['*']
    },
    {
        id: 'r_org_admin',
        name: 'org_admin',
        displayName: 'Organization Admin',
        scope: RoleScope.ORGANIZATION,
        description: 'Manage organization and projects',
        permissionCodes: ['org:view', 'org:edit', 'org:manage_users', 'project:*', 'data:*', 'dashboard:*', 'chart:*', 'ai:*']
    },
    {
        id: 'r_org_member',
        name: 'org_member',
        displayName: 'Organization Member',
        scope: RoleScope.ORGANIZATION,
        description: 'Standard organization member',
        permissionCodes: ['org:view', 'project:view', 'project:create', 'data:view', 'data:create', 'dashboard:*', 'chart:*', 'ai:use']
    },
    {
        id: 'r_org_viewer',
        name: 'org_viewer',
        displayName: 'Organization Viewer',
        scope: RoleScope.ORGANIZATION,
        description: 'Read-only access',
        permissionCodes: ['org:view', 'project:view', 'data:view', 'dashboard:view', 'chart:view']
    },
    // Project Roles
    {
        id: 'r_proj_owner',
        name: 'project_owner',
        displayName: 'Project Owner',
        scope: RoleScope.PROJECT,
        description: 'Full control over project',
        permissionCodes: ['project:*', 'data:*', 'dashboard:*', 'chart:*', 'ai:*']
    },
    {
        id: 'r_proj_editor',
        name: 'project_editor',
        displayName: 'Project Editor',
        scope: RoleScope.PROJECT,
        description: 'Edit project content',
        permissionCodes: ['project:view', 'project:edit', 'data:view', 'data:create', 'data:edit', 'dashboard:*', 'chart:*', 'ai:use']
    },
    {
        id: 'r_proj_viewer',
        name: 'project_viewer',
        displayName: 'Project Viewer',
        scope: RoleScope.PROJECT,
        description: 'View project content',
        permissionCodes: ['project:view', 'data:view', 'dashboard:view', 'chart:view']
    },
];

// --- MOCK USERS ---
export const INITIAL_USERS: User[] = [
    {
        id: 'u1',
        username: 'jdoe',
        email: 'makarasok1624@gmail.com',
        jobTitle: 'Senior Software Engineer',
        company: 'Acme Inc.',
        location: 'San Francisco, CA',
        bio: 'Passionate about building scalable web applications and data visualization tools.',
        timezone: 'UTC-08:00 (Pacific Time)'
    },
    { id: 'u2', username: 'alice', email: 'alice@example.com', company: 'Acme Inc.', jobTitle: 'Product Manager' },
    { id: 'u3', username: 'bob', email: 'bob@example.com', company: 'Acme Inc.', jobTitle: 'Data Analyst' },
    { id: 'u4', username: 'charlie', email: 'charlie@example.com', company: 'Acme Inc.', jobTitle: 'Junior Dev' },
];

// --- MOCK ORGANIZATION ---
export const INITIAL_ORG: Organization = {
    id: 'org1',
    name: 'Acme Inc.',
    createdAt: new Date().toISOString(),
};

// --- MOCK PROJECTS ---
export const INITIAL_PROJECTS: Project[] = [
    { id: 'p_personal_u1', organizationId: 'org1', name: 'My Project', description: 'Personal workspace', createdAt: new Date().toISOString(), createdBy: 'u1', isPersonal: true },
    { id: 'p_personal_u2', organizationId: 'org1', name: 'My Project', description: 'Personal workspace', createdAt: new Date().toISOString(), createdBy: 'u2', isPersonal: true },
    { id: 'p_personal_u3', organizationId: 'org1', name: 'My Project', description: 'Personal workspace', createdAt: new Date().toISOString(), createdBy: 'u3', isPersonal: true },
    { id: 'p_personal_u4', organizationId: 'org1', name: 'My Project', description: 'Personal workspace', createdAt: new Date().toISOString(), createdBy: 'u4', isPersonal: true },

    { id: 'p1', organizationId: 'org1', name: 'Marketing Analytics', description: 'Q1 Marketing performance tracking', createdAt: new Date().toISOString(), createdBy: 'u2' },
    { id: 'p2', organizationId: 'org1', name: 'Sales Pipeline', description: 'Global sales opportunities', createdAt: new Date().toISOString(), createdBy: 'u2' },
];

// --- MOCK USER ROLES ---
export const INITIAL_USER_ROLES: UserRole[] = [
    // Org Roles
    { id: 'ur1', userId: 'u1', roleId: 'r_org_owner', organizationId: 'org1' },
    { id: 'ur2', userId: 'u2', roleId: 'r_org_admin', organizationId: 'org1' },
    { id: 'ur3', userId: 'u3', roleId: 'r_org_member', organizationId: 'org1' },
    { id: 'ur6', userId: 'u4', roleId: 'r_org_member', organizationId: 'org1' },

    // Project Roles - Personal
    { id: 'ur_p1', userId: 'u1', roleId: 'r_proj_owner', projectId: 'p_personal_u1' },
    { id: 'ur_p2', userId: 'u2', roleId: 'r_proj_owner', projectId: 'p_personal_u2' },
    { id: 'ur_p3', userId: 'u3', roleId: 'r_proj_owner', projectId: 'p_personal_u3' },
    { id: 'ur_p4', userId: 'u4', roleId: 'r_proj_owner', projectId: 'p_personal_u4' },

    // Project Roles - Shared
    { id: 'ur4', userId: 'u2', roleId: 'r_proj_owner', projectId: 'p1' },
    { id: 'ur5', userId: 'u3', roleId: 'r_proj_viewer', projectId: 'p1' },
    { id: 'ur7', userId: 'u4', roleId: 'r_proj_editor', projectId: 'p2' },
];

// --- MOCK DATA SOURCES ---
export const INITIAL_DATA_SOURCES: DataSource[] = [
    { id: 'ds1', projectId: 'p1', name: 'Google Ads API', type: 'api', status: 'active', createdAt: new Date().toISOString(), createdBy: 'u2', rows: 15420, size: '2.4 MB', lastUsed: '2 hours ago' },
    { id: 'ds2', projectId: 'p1', name: 'Marketing PostgreSQL', type: 'postgres', status: 'active', createdAt: new Date().toISOString(), createdBy: 'u2', rows: 850040, size: '145 MB', lastUsed: '10 mins ago' },
    { id: 'ds3', projectId: 'p2', name: 'Salesforce CSV Export', type: 'csv', status: 'pending', createdAt: new Date().toISOString(), createdBy: 'u4', rows: 0, size: '0 KB', lastUsed: 'Never' },
];

// --- MOCK DASHBOARDS ---
export const INITIAL_DASHBOARDS: Dashboard[] = [
    {
        id: 'db1',
        projectId: 'p1',
        name: 'Campaign Performance',
        description: 'Comprehensive overview of Q1 marketing campaigns, traffic sources, and conversion metrics.',
        config: {},
        createdAt: new Date().toISOString(),
        charts: [
            {
                id: 'c1',
                title: 'Monthly Traffic Overview',
                description: 'Total visitors broken down by month',
                type: 'area',
                colSpan: 2,
                config: {
                    xAxisKey: 'month',
                    showGrid: true,
                    showLegend: true,
                    series: [
                        { key: 'organic', name: 'Organic', color: '#14b8a6' }, // teal-500
                        { key: 'paid', name: 'Paid Search', color: '#8b5cf6' }, // violet-500
                    ]
                },
                data: [
                    { month: 'Jan', organic: 4000, paid: 2400 },
                    { month: 'Feb', organic: 3000, paid: 1398 },
                    { month: 'Mar', organic: 2000, paid: 9800 },
                    { month: 'Apr', organic: 2780, paid: 3908 },
                    { month: 'May', organic: 1890, paid: 4800 },
                    { month: 'Jun', organic: 2390, paid: 3800 },
                    { month: 'Jul', organic: 3490, paid: 4300 },
                ]
            },
            {
                id: 'c2',
                title: 'Device Distribution',
                description: 'User sessions by device type',
                type: 'pie',
                colSpan: 1,
                config: {
                    series: [
                        { key: 'value', name: 'Sessions', color: '' } // color handled in data for pie
                    ],
                    showLegend: true
                },
                data: [
                    { name: 'Desktop', value: 400, fill: '#3b82f6' },
                    { name: 'Mobile', value: 300, fill: '#14b8a6' },
                    { name: 'Tablet', value: 100, fill: '#f59e0b' },
                    { name: 'Other', value: 50, fill: '#64748b' },
                ]
            },
            {
                id: 'c3',
                title: 'Conversion Funnel',
                description: 'User journey from impression to purchase',
                type: 'bar',
                colSpan: 3,
                config: {
                    xAxisKey: 'stage',
                    showGrid: true,
                    series: [{ key: 'users', name: 'Users', color: '#10b981' }]
                },
                data: [
                    { stage: 'Impressions', users: 12000 },
                    { stage: 'Clicks', users: 8500 },
                    { stage: 'Visits', users: 6200 },
                    { stage: 'Add to Cart', users: 2400 },
                    { stage: 'Checkout', users: 1200 },
                    { stage: 'Purchase', users: 850 },
                ]
            }
        ]
    },
    {
        id: 'db2',
        projectId: 'p2',
        name: 'Q4 Revenue Forecast',
        description: 'Revenue predictions based on current sales pipeline and historical data.',
        config: {},
        createdAt: new Date().toISOString(),
        charts: [
            {
                id: 'c4',
                title: 'Revenue Projections',
                description: 'Projected vs Actual Revenue',
                type: 'composed',
                colSpan: 3,
                config: {
                    xAxisKey: 'quarter',
                    showGrid: true,
                    showLegend: true,
                    series: [
                        { key: 'actual', name: 'Actual Revenue', color: '#3b82f6' },
                        { key: 'projected', name: 'Projected', color: '#f59e0b' },
                    ]
                },
                data: [
                    { quarter: 'Q1', actual: 150000, projected: 145000 },
                    { quarter: 'Q2', actual: 180000, projected: 175000 },
                    { quarter: 'Q3', actual: 210000, projected: 220000 },
                    { quarter: 'Q4', actual: 290000, projected: 310000 },
                ]
            }
        ]
    },
];
