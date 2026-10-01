/** Route → the sidebar section holding it, so the section opens on that page. */
export const ROUTE_OPEN_KEYS: Record<string, string[]> = {
  '/query-editor': ['sec-analyze'],
  '/notebooks': ['sec-analyze'],
  '/sheets': ['sec-analyze'],
  '/spatial': ['sec-analyze'],
  '/models': ['sec-predict'],
  '/ai-decisions': ['sec-predict'],
  '/data': ['sec-data'],
  '/knowledge': ['sec-data'],
  '/warehouse': ['sec-data'],
  '/data-platform': ['sec-data'],
  '/pipelines': ['sec-data'],
  '/catalog': ['sec-data'],
};

export const NAV_ROUTES: Record<string, string> = {
  chat: '/chat',
  dashboards: '/dashboards',
  feed: '/feed',
  'chart-designer': '/chart-designer',
  'query-editor': '/query-editor',
  notebooks: '/notebooks',
  sheets: '/sheets',
  spatial: '/spatial',
  warehouse: '/warehouse',
  models: '/models',
  data: '/data',
  knowledge: '/knowledge',
  'ai-decisions': '/ai-decisions',
  alerts: '/alerts',
  'platform-services': '/data-platform',
  pipelines: '/pipelines',
  catalog: '/catalog',
  settings: '/settings',
  billing: '/settings?tab=billing-subscription',
};

/**
 * Single source of truth for nav-item display labels (keys into the `nav` i18n namespace).
 * Shared by the sidebar (Navigation.tsx) and the header's page crumb (HeaderPageCrumb) so labels never drift apart.
 */
export const NAV_LABEL_KEYS: Record<string, string> = {
  chat: 'ai_engine',
  feed: 'feed',
  dashboards: 'dashboard_studio',
  'chart-designer': 'chart_designer',
  alerts: 'alerts',
  'sec-analyze': 'cat_analyze',
  'query-editor': 'query_editor',
  notebooks: 'notebooks',
  sheets: 'sheets',
  spatial: 'spatial',
  'sec-predict': 'cat_ai',
  models: 'models',
  'ai-decisions': 'ai_decisions',
  'sec-data': 'cat_data',
  data: 'data',
  knowledge: 'knowledge_libraries',
  warehouse: 'warehouse',
  'platform-services': 'integrations',
  pipelines: 'pipelines',
  catalog: 'catalog',
  settings: 'settings',
  billing: 'billing',
};

/** Nav key → its section, for breadcrumb trails (Predict & decide > Prediction models).
 * Everyday pages (Ask, Shared insights, Dashboards…) have no section and no crumb trail. */
export const NAV_PARENT_GROUP: Record<string, string> = {
  'query-editor': 'sec-analyze',
  notebooks: 'sec-analyze',
  sheets: 'sec-analyze',
  spatial: 'sec-analyze',
  models: 'sec-predict',
  'ai-decisions': 'sec-predict',
  data: 'sec-data',
  knowledge: 'sec-data',
  warehouse: 'sec-data',
  'platform-services': 'sec-data',
  pipelines: 'sec-data',
  catalog: 'sec-data',
};

/** One-line hover hints: what each page is for, in plain words (technical names kept
 * findable for power users, e.g. "AI analytics engine", "formerly Query Editor"). */
export const NAV_HINT_KEYS: Record<string, string> = {
  chat: 'hint_ask',
  feed: 'hint_feed',
  dashboards: 'hint_dashboards',
  'chart-designer': 'hint_chart_library',
  alerts: 'hint_alerts',
  'query-editor': 'hint_sql_editor',
  notebooks: 'hint_notebooks',
  sheets: 'hint_sheets',
  spatial: 'hint_maps',
  models: 'hint_models',
  'ai-decisions': 'hint_ai_decisions',
  data: 'hint_data_sources',
  knowledge: 'hint_documents',
  warehouse: 'hint_warehouse',
  pipelines: 'hint_pipelines',
  catalog: 'hint_catalog',
  'sec-analyze': 'hint_analyze',
  'sec-predict': 'hint_ai',
  'sec-data': 'hint_my_data',
};

export interface NavLinkDef {
  key: string;
  labelKey: string;
  href: string;
}

export interface NavGroupDef {
  key: string;
  labelKey: string;
  children: NavLinkDef[];
}

/** Sidebar entries. A section is a small, foldable heading over a short flat list — one
 * level of nesting at most, so every page is one click away once its section is open. */
export type NavItemDef =
  | { kind: 'link'; key: string; labelKey: string; href: string }
  | { kind: 'group'; key: string; labelKey: string; children: NavLinkDef[] }
  | { kind: 'section'; key: string; labelKey: string; children: NavLinkDef[] }
  | { kind: 'divider' };

export function flattenNavLinks(items: NavItemDef[]): NavLinkDef[] {
  const links: NavLinkDef[] = [];
  for (const item of items) {
    if (item.kind === 'link') {
      links.push({ key: item.key, labelKey: item.labelKey, href: item.href });
    } else if (item.kind === 'group' || item.kind === 'section') {
      links.push(...item.children);
    }
  }
  return links;
}

/** Maps (/spatial) is switched off until it's ready; NEXT_PUBLIC_FEATURE_MAPS=true brings it back. */
export const MAPS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_MAPS === 'true';
const analyzeTools = (): string[] => ['query-editor', 'sheets', 'notebooks', ...(MAPS_ENABLED ? ['spatial'] : [])];

const link = (key: string): NavLinkDef => ({ key, labelKey: NAV_LABEL_KEYS[key], href: NAV_ROUTES[key] });
const top = (key: string): NavItemDef => ({ kind: 'link', ...link(key) });
const section = (key: string, children: string[]): NavItemDef => ({
  kind: 'section', key, labelKey: NAV_LABEL_KEYS[key], children: children.map(link),
});

export function buildEnterpriseSidebarItems(showAiNav: boolean): NavItemDef[] {
  // Everyday work first and always open (ask, see what the team shared, dashboards, alerts);
  // then what builders use — analysis tools, predictions and decisions — and the data itself.
  // Builder sections fold by default for people who only consume (see defaultFoldedSections).
  return [
    ...(showAiNav ? [top('chat')] : []),
    top('feed'),
    top('dashboards'),
    top('chart-designer'),
    top('alerts'),
    section('sec-analyze', analyzeTools()),
    ...(showAiNav ? [section('sec-predict', ['models', 'ai-decisions'])] : [section('sec-predict', ['models'])]),
    section('sec-data', ['data', 'knowledge', 'warehouse', 'pipelines', 'catalog']),
  ];
}

export function buildCommunitySidebarItems(): NavItemDef[] {
  return [
    top('dashboards'),
    top('chart-designer'),
    top('feed'),
    section('sec-analyze', analyzeTools()),
    section('sec-data', ['data', 'knowledge']),
  ];
}

/** Sections folded when someone first opens the app: builder tools for people who only
 * view, data plumbing for everyone but those who connect data or run the organization.
 * Their own folding choices then win (remembered per browser). */
export function defaultFoldedSections(access: { canBuild: boolean; canManageData: boolean }): string[] {
  return [
    ...(access.canBuild ? [] : ['sec-analyze', 'sec-predict']),
    ...(access.canManageData ? [] : ['sec-data']),
  ];
}

export function openKeysForPathname(pathname: string | null): string[] {
  if (!pathname) return [];
  for (const [prefix, keys] of Object.entries(ROUTE_OPEN_KEYS)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return keys;
    }
  }
  if (pathname.includes('/semantic')) return ['sec-data'];
  return [];
}

export function selectedKeyForPathname(pathname: string | null, search?: string | null): string {
  if (!pathname) return '';
  if (pathname === '/chat' || pathname === '/ai-search' || pathname === '/ai-analytics') return 'chat';
  if (pathname === '/data') return 'data';
  if (pathname === '/knowledge') return 'knowledge';
  if (pathname === '/ai-decisions') return 'ai-decisions';
  if (pathname.startsWith('/settings')) {
    const tab = search ? new URLSearchParams(search).get('tab') : null;
    return tab === 'billing-subscription' ? 'billing' : 'settings';
  }
  if (pathname.startsWith('/feed')) return 'feed';
  if (pathname === '/query-editor') return 'query-editor';
  if (pathname === '/dashboards') return 'dashboards';
  if (pathname === '/chart-designer') return 'chart-designer';
  if (pathname.startsWith('/data-platform')) return 'platform-services';
  if (pathname.startsWith('/pipelines')) return 'pipelines';
  if (pathname.startsWith('/catalog')) return 'catalog';
  if (pathname === '/alerts') return 'alerts';
  // Pages added later were missing here, so the sidebar highlighted nothing on them.
  for (const key of ['notebooks', 'sheets', 'spatial', 'warehouse', 'models', 'dashboards'] as const) {
    if (pathname === NAV_ROUTES[key] || pathname.startsWith(`${NAV_ROUTES[key]}/`)) return key;
  }
  return '';
}
