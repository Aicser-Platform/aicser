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
import { Layout, Tooltip } from 'antd';
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

function isNavOverlayTarget(target: Node | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest('.sidebar-nav-popover-layer, .app-navigation-sider');
}

const Navigation: React.FC<NavigationProps> = (props: NavigationProps) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const sidebarNavRef = React.useRef<SidebarNavHandle>(null);
  const t = useTranslations('nav');
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

  const sidebarGradient = isDarkMode
    ? 'linear-gradient(135deg, var(--color-bg-navigation-sider, var(--color-bg-navigation)) 0%, var(--color-bg-navigation-sider-glow, rgba(24, 144, 255, 0.15)) 100%)'
    : 'linear-gradient(135deg, var(--color-bg-navigation-sider, var(--color-bg-navigation)) 0%, var(--color-bg-navigation-sider-glow, rgba(255,255,255,0.25)) 100%)';

  const settingsActive = selectedKey === 'settings';

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
        background: sidebarGradient,
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
      <div className="app-navigation-sider-inner">
        <div className="app-navigation-brand">
          <AicserLogo size={isRailMode ? 32 : 36} showText={!isRailMode} text={brandText} />
        </div>

        <div className="app-navigation-scroll">
          <SidebarNav
            ref={sidebarNavRef}
            items={isEnterpriseEdition ? enterpriseItems : communityItems}
            selectedKey={selectedKey}
            routeOpenGroups={routeOpenGroups}
            railCollapsed={isRailMode}
            onNavigate={onNavigate}
            icons={isEnterpriseEdition ? ENTERPRISE_ICONS : COMMUNITY_ICONS}
          />
        </div>

        <div className="app-navigation-footer">
          {isRailMode ? (
            <Tooltip title={t('settings')} placement="right" mouseEnterDelay={0.35}>
              <button
                type="button"
                className={`sidebar-nav-link sidebar-nav-link--footer${settingsActive ? ' is-active' : ''}`}
                onClick={() => onNavigate(NAV_ROUTES.settings)}
              >
                <span className="sidebar-nav-link-icon">
                  <SettingOutlined />
                </span>
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              className={`sidebar-nav-link sidebar-nav-link--footer${settingsActive ? ' is-active' : ''}`}
              onClick={() => onNavigate(NAV_ROUTES.settings)}
            >
              <span className="sidebar-nav-link-icon">
                <SettingOutlined />
              </span>
              <span className="sidebar-nav-link-label">{t('settings')}</span>
            </button>
          )}
        </div>
      </div>
    </Sider>
  );
};

export default React.memo(Navigation);
