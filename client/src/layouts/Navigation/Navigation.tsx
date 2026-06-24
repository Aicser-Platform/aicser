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
  BookOutlined,
  RadarChartOutlined,
  NodeIndexOutlined,
  BellOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { Layout } from 'antd';
import { useRouter, usePathname } from 'next/navigation';
import React from 'react';
import AicserLogo from '@/components/ui/Logo/AicserLogo';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useTranslations } from 'next-intl';
import {
  NAV_ROUTES,
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
  'semantic-model': <NodeIndexOutlined />,
  knowledge: <BookOutlined />,
  'grp-operate': <RadarChartOutlined />,
  alerts: <BellOutlined />,
  'platform-services': <ApiOutlined />,
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

const SETTINGS_ITEMS: NavItemDef[] = [
  { kind: 'link', key: 'settings', labelKey: 'settings', href: NAV_ROUTES.settings },
];

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
  const selectedKey = React.useMemo(() => selectedKeyForPathname(pathname), [pathname]);
  const routeOpenGroups = React.useMemo(() => openKeysForPathname(pathname), [pathname]);

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
      { kind: 'link', key: 'chat', labelKey: 'ai_engine', href: NAV_ROUTES.chat },
      { kind: 'link', key: 'query-editor', labelKey: 'query_editor', href: NAV_ROUTES['query-editor'] },
      { kind: 'link', key: 'feed', labelKey: 'feed', href: NAV_ROUTES.feed },
      {
        kind: 'group',
        key: 'dashboard-studio',
        labelKey: 'dashboard_studio',
        children: [
          { key: 'dashboards', labelKey: 'dashboards', href: NAV_ROUTES.dashboards },
          { key: 'chart-designer', labelKey: 'chart_designer', href: NAV_ROUTES['chart-designer'] },
        ],
      },
      { kind: 'divider' },
      {
        kind: 'group',
        key: 'grp-data',
        labelKey: 'cat_data',
        children: [
          { key: 'data', labelKey: 'data', href: NAV_ROUTES.data },
          { key: 'semantic-model', labelKey: 'semantic_layer', href: NAV_ROUTES['semantic-model'] },
          { key: 'knowledge', labelKey: 'knowledge_libraries', href: NAV_ROUTES.knowledge },
        ],
      },
      {
        kind: 'group',
        key: 'grp-operate',
        labelKey: 'cat_monitor',
        children: [
          { key: 'alerts', labelKey: 'alerts', href: NAV_ROUTES.alerts },
          { key: 'platform-services', labelKey: 'integrations', href: NAV_ROUTES['platform-services'] },
        ],
      },
    ],
    []
  );

  const communityItems = React.useMemo<NavItemDef[]>(
    () => [
      { kind: 'link', key: 'dashboards', labelKey: 'dashboards', href: NAV_ROUTES.dashboards },
      { kind: 'link', key: 'chart-designer', labelKey: 'chart_designer', href: NAV_ROUTES['chart-designer'] },
      { kind: 'link', key: 'feed', labelKey: 'feed', href: NAV_ROUTES.feed },
      { kind: 'link', key: 'query-editor', labelKey: 'query_editor', href: NAV_ROUTES['query-editor'] },
      { kind: 'link', key: 'data', labelKey: 'data', href: NAV_ROUTES.data },
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
            items={SETTINGS_ITEMS}
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
