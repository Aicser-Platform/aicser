'use client';

import useClickOutside from '@/hooks/useClickOutside';
import {
  DatabaseOutlined,
  MessageOutlined,
  SettingOutlined,
  DashboardOutlined,
  CodeOutlined,
  AppstoreOutlined,
  AreaChartOutlined,
  NodeIndexOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { Layout } from 'antd';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import React from 'react';
import AicserLogo from '@/components/ui/Logo/AicserLogo';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useTranslations } from 'next-intl';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';
import {
  NAV_ROUTES,
  NAV_LABEL_KEYS,
  openKeysForPathname,
  selectedKeyForPathname,
  type NavItemDef,
} from './navConfig';
import SidebarNav, { RAIL_WIDTH, type SidebarNavHandle, type SidebarNavIconMap } from './SidebarNav';

const { Sider } = Layout;
const EXPANDED_WIDTH = 256;

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

interface NavigationProps {
  collapsed: boolean;
  isBreakpoint: boolean;
  onBreakpoint: (broken: boolean) => void;
  onCollapse: (collapsed: boolean) => void;
}

const ENTERPRISE_ICONS: SidebarNavIconMap = {
  chat: <MessageOutlined />,
  'query-editor': <CodeOutlined />,
  feed: <AppstoreOutlined />,
  'dashboard-studio': <DashboardOutlined />,
  dashboards: <DashboardOutlined />,
  'chart-designer': <AreaChartOutlined />,
  'grp-data': <DatabaseOutlined />,
  data: <DatabaseOutlined />,
  'grp-operate': <AppstoreOutlined />,
  'platform-services': <AppstoreOutlined />,
  pipelines: <NodeIndexOutlined />,
  catalog: <ApartmentOutlined />,
  settings: <SettingOutlined />,
};

const COMMUNITY_ICONS: SidebarNavIconMap = {
  dashboards: <DashboardOutlined />,
  'chart-designer': <AreaChartOutlined />,
  feed: <AppstoreOutlined />,
  'query-editor': <CodeOutlined />,
  data: <DatabaseOutlined />,
  settings: <SettingOutlined />,
};

function buildSettingsItems(_enterprise: boolean): NavItemDef[] {
  // Billing intentionally does NOT get a top-level sidebar entry — it's reachable
  // from the user profile dropdown (which already shows plan/usage) via a direct
  // "Manage Billing" link, matching how Stripe/GitHub/Linear/Vercel place billing
  // under the account menu rather than as a primary nav item. Giving it equal visual
  // weight to Dashboards/Query Editor in the sidebar was a placement mistake — see
  // UserProfileDropdown.tsx for the actual fix.
  return [{ kind: 'link', key: 'settings', labelKey: NAV_LABEL_KEYS.settings, href: NAV_ROUTES.settings }];
}

const SETTINGS_ICONS: SidebarNavIconMap = {
  settings: <SettingOutlined />,
};

function isNavOverlayTarget(target: Node | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest('.ant-menu-submenu-popup, .app-navigation-sider');
}

const Navigation: React.FC<NavigationProps> = (props: NavigationProps) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const sidebarNavRef = React.useRef<SidebarNavHandle>(null);
  const t_common = useTranslations('common');
  const brandText = isEnterpriseEdition ? t_common('brand_name') : `${t_common('brand_name')} Community Edition`;

  useClickOutside(ref, (event) => {
    const target = (event.target as Node) ?? null;
    if (isNavOverlayTarget(target)) return;
    if (props.isBreakpoint && !props.collapsed) {
      props.onCollapse(true);
    }
    sidebarNavRef.current?.dismissOverlays();
  });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedKey = React.useMemo(
    () => selectedKeyForPathname(pathname, searchParams?.toString() ? `?${searchParams.toString()}` : null),
    [pathname, searchParams]
  );
  const routeOpenGroups = React.useMemo(() => openKeysForPathname(pathname), [pathname]);
  const settingsItems = React.useMemo(() => buildSettingsItems(isEnterpriseEdition), []);
  const showAiNav = isEnterpriseEdition && isAiFrontendEnabled();

  const onNavigate = React.useCallback(
    (href: string) => {
      router.push(href);
      sidebarNavRef.current?.dismissOverlays();
      if (props.isBreakpoint) props.onCollapse(true);
    },
    [router, props]
  );

  const enterpriseItems = React.useMemo<NavItemDef[]>(
    () => [
      ...(showAiNav ? [{ kind: 'link' as const, key: 'chat', labelKey: NAV_LABEL_KEYS.chat, href: NAV_ROUTES.chat }] : []),
      { kind: 'link', key: 'query-editor', labelKey: NAV_LABEL_KEYS['query-editor'], href: NAV_ROUTES['query-editor'] },
      { kind: 'link', key: 'feed', labelKey: NAV_LABEL_KEYS.feed, href: NAV_ROUTES.feed },
      {
        kind: 'group',
        key: 'dashboard-studio',
        labelKey: NAV_LABEL_KEYS['dashboard-studio'],
        children: [
          { key: 'dashboards', labelKey: NAV_LABEL_KEYS.dashboards, href: NAV_ROUTES.dashboards },
          { key: 'chart-designer', labelKey: NAV_LABEL_KEYS['chart-designer'], href: NAV_ROUTES['chart-designer'] },
        ],
      },
      { kind: 'divider' },
      {
        kind: 'group',
        key: 'grp-data',
        labelKey: NAV_LABEL_KEYS['grp-data'],
        children: [
          { key: 'data', labelKey: NAV_LABEL_KEYS.data, href: NAV_ROUTES.data },
        ],
      },
      {
        kind: 'group',
        key: 'grp-operate',
        labelKey: NAV_LABEL_KEYS['grp-operate'],
        children: [
          { key: 'catalog', labelKey: NAV_LABEL_KEYS.catalog, href: NAV_ROUTES.catalog },
        ],
      },
    ],
    [showAiNav]
  );

  const communityItems = React.useMemo<NavItemDef[]>(
    () => [
      { kind: 'link', key: 'dashboards', labelKey: NAV_LABEL_KEYS.dashboards, href: NAV_ROUTES.dashboards },
      { kind: 'link', key: 'chart-designer', labelKey: NAV_LABEL_KEYS['chart-designer'], href: NAV_ROUTES['chart-designer'] },
      { kind: 'link', key: 'feed', labelKey: NAV_LABEL_KEYS.feed, href: NAV_ROUTES.feed },
      { kind: 'link', key: 'query-editor', labelKey: NAV_LABEL_KEYS['query-editor'], href: NAV_ROUTES['query-editor'] },
      { kind: 'link', key: 'data', labelKey: NAV_LABEL_KEYS.data, href: NAV_ROUTES.data },
    ],
    []
  );

  const isMobile = props.isBreakpoint;
  const isRailMode = props.collapsed && !isMobile;
  const sidebarWidth = isRailMode ? RAIL_WIDTH : EXPANDED_WIDTH;

  const { isDarkMode: isDarkModeContext } = useThemeMode();
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  React.useEffect(() => setIsDarkMode(!!isDarkModeContext), [isDarkModeContext]);

  return (
    <Sider
      ref={ref}
      theme={isDarkMode ? 'dark' : 'light'}
      collapsible
      collapsed={props.collapsed}
      trigger={null}
      breakpoint="lg"
      width={sidebarWidth}
      collapsedWidth={isMobile ? 0 : RAIL_WIDTH}
      className={`app-navigation-sider${isDarkMode ? ' app-navigation-sider--dark' : ''}`}
      style={{
        transition: 'min-width 0.2s ease, width 0.2s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)',
        background: 'var(--color-bg-navigation-sider, var(--color-bg-navigation))',
        ...(isMobile
          ? {
            top: 64,
            height: 'calc(100vh - 64px)',
            transform: props.collapsed ? 'translateX(-100%)' : 'translateX(0)',
            boxShadow: props.collapsed ? 'none' : '4px 0 24px rgba(0, 0, 0, 0.25)',
          }
          : {}),
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={`box-border flex h-[var(--app-header-height,64px)] min-h-[var(--app-header-height,64px)] max-h-[var(--app-header-height,64px)] min-w-0 shrink-0 items-center overflow-hidden border-b border-[var(--ant-color-border)] p-3 ${isRailMode ? 'justify-center' : ''}`}
        >
          <AicserLogo size={isRailMode ? 32 : 36} showText={!isRailMode} text={brandText} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-0 pb-2 pt-1">
          <SidebarNav
            ref={sidebarNavRef}
            items={isEnterpriseEdition ? enterpriseItems : communityItems}
            selectedKey={selectedKey}
            routeOpenGroups={routeOpenGroups}
            railCollapsed={isRailMode}
            onNavigate={onNavigate}
            icons={isEnterpriseEdition ? ENTERPRISE_ICONS : COMMUNITY_ICONS}
            theme={isDarkMode ? 'dark' : 'light'}
          />
        </div>

        <div className="shrink-0 border-t border-[var(--ant-color-border)] px-0 pb-2 pt-1">
          <SidebarNav
            items={settingsItems}
            selectedKey={selectedKey}
            routeOpenGroups={[]}
            railCollapsed={isRailMode}
            onNavigate={onNavigate}
            icons={SETTINGS_ICONS}
            theme={isDarkMode ? 'dark' : 'light'}
          />
        </div>
      </div>
    </Sider>
  );
};

export default React.memo(Navigation);
