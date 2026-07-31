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
export function primaryMobileTabKeys(isEnterprise: boolean, aiEnabled = true): string[] {
  const tabs = isEnterprise
    ? aiEnabled
      ? EE_MOBILE_TABS
      : EE_MOBILE_TABS.filter((t) => t.key !== 'chat')
    : CE_MOBILE_TABS;
  return tabs.map((t) => t.key);
}

export function isMoreNavActive(selectedKey: string, isEnterprise: boolean, aiEnabled = true): boolean {
  if (!selectedKey || selectedKey === 'more') return false;
  return !primaryMobileTabKeys(isEnterprise, aiEnabled).includes(selectedKey);
}

export function enterpriseMoreNavItems(): NavItemDef[] {
  return [
    { kind: 'link', key: 'query-editor', labelKey: 'query_editor', href: NAV_ROUTES['query-editor'] },
    { kind: 'link', key: 'chart-designer', labelKey: 'chart_designer', href: NAV_ROUTES['chart-designer'] },
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
