import type { NavItemDef } from './navConfig';
import { MAPS_ENABLED, NAV_LABEL_KEYS, NAV_ROUTES } from './navConfig';

export type MobileTabDef = {
  key: string;
  labelKey: string;
  href: string;
};

/** Primary bottom tabs — max 4 + More (industry standard). */
// Same job labels and order as the desktop rail (QA S-ASK-09): Ask first; short group names on tabs.
export const EE_MOBILE_TABS: MobileTabDef[] = [
  { key: 'chat', labelKey: 'ai_engine', href: NAV_ROUTES.chat },
  { key: 'feed', labelKey: 'feed', href: NAV_ROUTES.feed },
  { key: 'dashboards', labelKey: 'dashboard_studio', href: NAV_ROUTES.dashboards },
  { key: 'data', labelKey: 'cat_data', href: NAV_ROUTES.data },
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

const moreLink = (key: string): NavItemDef => ({ kind: 'link', key, labelKey: NAV_LABEL_KEYS[key], href: NAV_ROUTES[key] });

/** Everything not on a tab, in the sidebar's order and sections. */
export function enterpriseMoreNavItems(): NavItemDef[] {
  return [
    moreLink('chart-designer'),
    moreLink('alerts'),
    { kind: 'divider' },
    moreLink('query-editor'),
    moreLink('sheets'),
    moreLink('notebooks'),
    ...(MAPS_ENABLED ? [moreLink('spatial')] : []),
    { kind: 'divider' },
    moreLink('models'),
    moreLink('ai-decisions'),
    { kind: 'divider' },
    moreLink('knowledge'),
    moreLink('warehouse'),
    moreLink('pipelines'),
    moreLink('catalog'),
    { kind: 'divider' },
    moreLink('settings'),
  ];
}

export function communityMoreNavItems(): NavItemDef[] {
  return [
    moreLink('chart-designer'),
    moreLink('sheets'),
    moreLink('notebooks'),
    ...(MAPS_ENABLED ? [moreLink('spatial')] : []),
    moreLink('knowledge'),
    { kind: 'divider' },
    { kind: 'link', key: 'settings', labelKey: 'settings', href: NAV_ROUTES.settings },
  ];
}
