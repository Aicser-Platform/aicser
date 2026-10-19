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
  '/lakehouse': ['sec-data'],
  '/pipelines': ['sec-data'],
  '/prepare': ['sec-data'],
  '/chart-designer': ['sec-analyze'],
  '/catalog': ['sec-data'],
  '/semantic-layer': ['sec-data'],
  '/master-data': ['sec-data'],
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
  warehouse: '/lakehouse',
  models: '/models',
  data: '/data',
  knowledge: '/knowledge',
  'ai-decisions': '/ai-decisions',
  alerts: '/alerts',
  pipelines: '/pipelines',
  prepare: '/prepare',
  catalog: '/catalog',
  'semantic-layer': '/semantic-layer',
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
  pipelines: 'pipelines',
  prepare: 'prepare',
  catalog: 'catalog',
  'semantic-layer': 'semantic_layer',
  settings: 'settings',
  billing: 'billing',
};

/** Nav key → its section, for breadcrumb trails (Predict & decide > Prediction models).
 * Everyday pages (Ask, Shared insights, Dashboards…) have no section and no crumb trail. */
export const NAV_PARENT_GROUP: Record<string, string> = {
  'chart-designer': 'sec-analyze',
  'query-editor': 'sec-analyze',
  notebooks: 'sec-analyze',
  sheets: 'sec-analyze',
  spatial: 'sec-analyze',
  models: 'sec-predict',
  'ai-decisions': 'sec-predict',
  data: 'sec-data',
  knowledge: 'sec-data',
  warehouse: 'sec-data',
  pipelines: 'sec-data',
  prepare: 'sec-data',
  catalog: 'sec-data',
  'semantic-layer': 'sec-data',
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
  prepare: 'hint_prepare',
  catalog: 'hint_catalog',
  'semantic-layer': 'hint_semantic_layer',
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
const analyzeTools = (): string[] => ['chart-designer', 'query-editor', 'sheets', 'notebooks', ...(MAPS_ENABLED ? ['spatial'] : [])];

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
    top('alerts'),
    section('sec-analyze', analyzeTools()),
    ...(showAiNav ? [section('sec-predict', ['models', 'ai-decisions'])] : [section('sec-predict', ['models'])]),
    // Connect → prepare → move → model → find. Lakehouse storage and compute are admin
    // settings (Settings › Lakehouse); Documents fold into the Catalog next.
    section('sec-data', ['data', 'prepare', 'pipelines', 'semantic-layer', 'catalog', 'knowledge']),
  ];
}

export type NavAccess = {
  hasFeature?: (feature: string) => boolean;
  hasPermission?: (permission: string) => boolean;
};

/** Sidebar key → plan feature that must be on. Everyday Analyze items stay ungated. */
export const NAV_FEATURE_GATE: Record<string, string> = {
  alerts: 'alerts',
  catalog: 'catalog',
  warehouse: 'lakehouse',
  pipelines: 'lakehouse',
  models: 'ml_models',
  'ai-decisions': 'ai_decisions',
};

/** Sidebar key → RBAC code. Applied only after permissions have loaded. */
export const NAV_PERMISSION_GATE: Record<string, string> = {
  alerts: 'alert:view',
  catalog: 'catalog:view',
};

function linkAllowed(key: string, access?: NavAccess): boolean {
  if (!access) return true;
  const feature = NAV_FEATURE_GATE[key];
  if (feature && access.hasFeature && !access.hasFeature(feature)) return false;
  const perm = NAV_PERMISSION_GATE[key];
  if (perm && access.hasPermission && !access.hasPermission(perm)) return false;
  return true;
}

function collapseNavDividers(items: NavItemDef[]): NavItemDef[] {
  const out: NavItemDef[] = [];
  for (const item of items) {
    if (item.kind === 'divider') {
      if (!out.length || out[out.length - 1].kind === 'divider') continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  if (out.length && out[out.length - 1].kind === 'divider') out.pop();
  return out;
}

/** Hide SKU/role-gated pages without changing everyday order. */
export function filterSidebarItems(items: NavItemDef[], access?: NavAccess): NavItemDef[] {
  const out: NavItemDef[] = [];
  for (const item of items) {
    if (item.kind === 'divider') {
      out.push(item);
      continue;
    }
    if (item.kind === 'link') {
      if (linkAllowed(item.key, access)) out.push(item);
      continue;
    }
    const children = item.children.filter((child) => linkAllowed(child.key, access));
    if (children.length) out.push({ ...item, children });
  }
  return collapseNavDividers(out);
}

export function buildCommunitySidebarItems(): NavItemDef[] {
  return [
    top('dashboards'),
    top('feed'),
    section('sec-analyze', analyzeTools()),
    section('sec-data', ['data', 'prepare', 'knowledge']),
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
  if (pathname === '/ai-decisions' || pathname.startsWith('/ai-decisions/')) return 'ai-decisions';
  if (pathname.startsWith('/settings')) {
    const tab = search ? new URLSearchParams(search).get('tab') : null;
    return tab === 'billing-subscription' ? 'billing' : 'settings';
  }
  if (pathname.startsWith('/feed')) return 'feed';
  if (pathname === '/query-editor') return 'query-editor';
  if (pathname === '/dashboards') return 'dashboards';
  if (pathname === '/chart-designer') return 'chart-designer';
  if (pathname.startsWith('/pipelines')) return 'pipelines';
  if (pathname === '/lakehouse' || pathname.startsWith('/lakehouse/')) return 'warehouse';
  if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return 'warehouse';
  if (pathname.startsWith('/catalog')) return 'catalog';
  if (pathname === '/semantic-layer' || pathname.startsWith('/semantic-layer/')) return 'semantic-layer';
  if (pathname === '/alerts') return 'alerts';
  // Pages added later were missing here, so the sidebar highlighted nothing on them.
  for (const key of ['notebooks', 'sheets', 'spatial', 'warehouse', 'models', 'dashboards', 'prepare'] as const) {
    if (pathname === NAV_ROUTES[key] || pathname.startsWith(`${NAV_ROUTES[key]}/`)) return key;
  }
  return '';
}
