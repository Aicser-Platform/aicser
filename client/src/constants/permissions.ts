/** RBAC permission slugs — safe to import from Server and Client Components. */
export enum Permission {
  ORG_VIEW = 'org:view',
  ORG_EDIT = 'org:edit',
  ORG_DELETE = 'org:delete',
  ORG_MANAGE_USERS = 'org:manage_users',
  ORG_MANAGE_BILLING = 'org:manage_billing',
  ORG_VIEW_ANALYTICS = 'org:view_analytics',

  PROJECT_VIEW = 'project:view',
  PROJECT_CREATE = 'project:create',
  PROJECT_EDIT = 'project:edit',
  PROJECT_DELETE = 'project:delete',
  PROJECT_MANAGE_MEMBERS = 'project:manage_members',
  PROJECT_EXPORT = 'project:export',

  DATA_VIEW = 'data:view',
  DATA_EDIT = 'data:edit',
  DATA_DELETE = 'data:delete',
  DATA_UPLOAD = 'data:upload',
  DATA_CONNECT = 'data:connect',

  CHART_VIEW = 'chart:view',
  CHART_EDIT = 'chart:edit',
  CHART_DELETE = 'chart:delete',
  CHART_SHARE = 'chart:share',
  DASHBOARD_VIEW = 'dashboard:view',
  DASHBOARD_CREATE = 'dashboard:create',
  DASHBOARD_EDIT = 'dashboard:edit',
  DASHBOARD_DELETE = 'dashboard:delete',
  DASHBOARD_PUBLISH = 'dashboard:publish',

  AI_USE = 'ai:use',
  AI_ADVANCED = 'ai:advanced',
  AI_TRAIN_MODELS = 'ai:train_models',

  KNOWLEDGE_VIEW = 'knowledge:view',
  KNOWLEDGE_CREATE = 'knowledge:create',
  KNOWLEDGE_EDIT = 'knowledge:edit',
  KNOWLEDGE_DELETE = 'knowledge:delete',
  KNOWLEDGE_SEARCH = 'knowledge:search',
  KNOWLEDGE_MANAGE_LIBRARIES = 'knowledge:manage_libraries',

  EMBED_CREATE = 'embed:create',
  EMBED_MANAGE = 'embed:manage',
  EMBED_VIEW = 'embed:view',

  AUDIT_VIEW = 'audit:view',

  AGENT_USE = 'agent:use',
  AGENT_CONFIGURE = 'agent:configure',

  QUERY_EXECUTE = 'query:execute',
  QUERY_SAVE = 'query:save',
  QUERY_SHARE = 'query:share',

  USER_VIEW_PROFILE = 'user:view_profile',
  USER_EDIT_PROFILE = 'user:edit_profile',
  USER_MANAGE_API_KEYS = 'user:manage_api_keys',
}
