/** Route → submenu keys that auto-expand for the active page. */
export const ROUTE_OPEN_KEYS: Record<string, string[]> = {
  '/dashboards': ['dashboard-studio'],
  '/chart-designer': ['dashboard-studio'],
  '/data': ['grp-data'],
  '/semantic-layer': ['grp-data'],
  '/model': ['grp-data'],
  '/knowledge': ['grp-data'],
  '/alerts': ['grp-operate'],
  '/data-platform': ['grp-operate'],
};

export const NAV_ROUTES: Record<string, string> = {
  chat: '/chat',
  dashboards: '/dashboards',
  feed: '/feed',
  'chart-designer': '/chart-designer',
  'query-editor': '/query-editor',
  data: '/data',
  'semantic-model': '/semantic-layer',
  knowledge: '/knowledge',
  alerts: '/alerts',
  'platform-services': '/data-platform',
  settings: '/settings',
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

export type NavItemDef =
  | { kind: 'link'; key: string; labelKey: string; href: string }
  | { kind: 'group'; key: string; labelKey: string; children: NavLinkDef[] }
  | { kind: 'divider' };

export function openKeysForPathname(pathname: string | null): string[] {
  if (!pathname) return [];
  for (const [prefix, keys] of Object.entries(ROUTE_OPEN_KEYS)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return keys;
    }
  }
  if (pathname.includes('/semantic')) return ['grp-data'];
  return [];
}

export function selectedKeyForPathname(pathname: string | null): string {
  if (!pathname) return '';
  if (pathname === '/chat' || pathname === '/ai-search') return 'chat';
  if (pathname === '/semantic-layer' || pathname === '/model' || pathname.includes('/semantic')) return 'semantic-model';
  if (pathname === '/data') return 'data';
  if (pathname === '/knowledge') return 'knowledge';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/feed')) return 'feed';
  if (pathname === '/query-editor') return 'query-editor';
  if (pathname === '/dashboards') return 'dashboards';
  if (pathname === '/chart-designer') return 'chart-designer';
  if (pathname === '/data-platform') return 'platform-services';
  if (pathname === '/alerts') return 'alerts';
  return '';
}
