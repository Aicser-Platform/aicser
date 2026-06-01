import type { NavItemDef } from './navConfig';
import { NAV_ROUTES } from './navConfig';

export type MobileTabDef = {
  key: string;
  labelKey: string;
  href: string;
};

/** Primary bottom tabs — max 4 + More (industry standard). */
export const EE_MOBILE_TABS: MobileTabDef[] = [
  { key: 'chat', labelKey: 'ai_engine', href: NAV_ROUTES.chat },
  { key: 'feed', labelKey: 'feed', href: NAV_ROUTES.feed },
  { key: 'data', labelKey: 'data', href: NAV_ROUTES.data },
  { key: 'dashboards', labelKey: 'dashboards', href: NAV_ROUTES.dashboards },
];

export const CE_MOBILE_TABS: MobileTabDef[] = [
  { key: 'dashboards', labelKey: 'dashboards', href: NAV_ROUTES.dashboards },
  { key: 'feed', labelKey: 'feed', href: NAV_ROUTES.feed },
  { key: 'data', labelKey: 'data', href: NAV_ROUTES.data },
  { key: 'query-editor', labelKey: 'query_editor', href: NAV_ROUTES['query-editor'] },
];

/** Keys matched by primary tabs (for highlighting "More"). */
export function primaryMobileTabKeys(isEnterprise: boolean): string[] {
  return (isEnterprise ? EE_MOBILE_TABS : CE_MOBILE_TABS).map((t) => t.key);
}

export function isMoreNavActive(selectedKey: string, isEnterprise: boolean): boolean {
  if (!selectedKey || selectedKey === 'more') return false;
  return !primaryMobileTabKeys(isEnterprise).includes(selectedKey);
}

export function enterpriseMoreNavItems(): NavItemDef[] {
  return [
    { kind: 'link', key: 'query-editor', labelKey: 'query_editor', href: NAV_ROUTES['query-editor'] },
    { kind: 'link', key: 'chart-designer', labelKey: 'chart_designer', href: NAV_ROUTES['chart-designer'] },
    { kind: 'divider' },
    { kind: 'link', key: 'semantic-model', labelKey: 'semantic_layer', href: NAV_ROUTES['semantic-model'] },
    { kind: 'link', key: 'knowledge', labelKey: 'knowledge_libraries', href: NAV_ROUTES.knowledge },
    { kind: 'divider' },
    { kind: 'link', key: 'alerts', labelKey: 'alerts', href: NAV_ROUTES.alerts },
    { kind: 'link', key: 'platform-services', labelKey: 'integrations', href: NAV_ROUTES['platform-services'] },
    { kind: 'divider' },
    { kind: 'link', key: 'settings', labelKey: 'settings', href: NAV_ROUTES.settings },
  ];
}

export function communityMoreNavItems(): NavItemDef[] {
  return [
    { kind: 'link', key: 'chart-designer', labelKey: 'chart_designer', href: NAV_ROUTES['chart-designer'] },
    { kind: 'divider' },
    { kind: 'link', key: 'settings', labelKey: 'settings', href: NAV_ROUTES.settings },
  ];
}
