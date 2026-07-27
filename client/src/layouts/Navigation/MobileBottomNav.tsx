'use client';

import React from 'react';
import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  CodeOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EllipsisOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  ApiOutlined,
  AreaChartOutlined,
} from '@ant-design/icons';
import { Drawer } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { selectedKeyForPathname } from './navConfig';
import SidebarNav, { type SidebarNavIconMap } from './SidebarNav';
import {
  CE_MOBILE_TABS,
  EE_MOBILE_TABS,
  communityMoreNavItems,
  enterpriseMoreNavItems,
  isMoreNavActive,
} from './mobileNavConfig';
import './MobileBottomNav.css';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

const TAB_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageOutlined />,
  feed: <AppstoreOutlined />,
  data: <DatabaseOutlined />,
  dashboards: <DashboardOutlined />,
  'query-editor': <CodeOutlined />,
};

const MORE_ICONS: SidebarNavIconMap = {
  'query-editor': <CodeOutlined />,
  'chart-designer': <AreaChartOutlined />,
  'semantic-model': <NodeIndexOutlined />,
  knowledge: <BookOutlined />,
  alerts: <BellOutlined />,
  'platform-services': <ApiOutlined />,
  settings: <SettingOutlined />,
};

export function MobileBottomNav() {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const selectedKey = React.useMemo(() => selectedKeyForPathname(pathname), [pathname]);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const tabs = isEnterpriseEdition ? EE_MOBILE_TABS : CE_MOBILE_TABS;
  const moreActive = isMoreNavActive(selectedKey, isEnterpriseEdition);
  const moreItems = isEnterpriseEdition ? enterpriseMoreNavItems() : communityMoreNavItems();

  const navigate = (href: string) => {
    setMoreOpen(false);
    router.push(href);
  };

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label={t('mobile_primary_nav')}>
        <ul className="mobile-bottom-nav__list">
          {tabs.map((tab) => {
            const active = selectedKey === tab.key;
            return (
              <li key={tab.key} className="mobile-bottom-nav__item">
                <button
                  type="button"
                  className={`mobile-bottom-nav__btn${active ? ' is-active' : ''}`}
                  onClick={() => navigate(tab.href)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="mobile-bottom-nav__icon">{TAB_ICONS[tab.key]}</span>
                  <span className="mobile-bottom-nav__label">{t(tab.labelKey as 'data')}</span>
                </button>
              </li>
            );
          })}
          <li className="mobile-bottom-nav__item">
            <button
              type="button"
              className={`mobile-bottom-nav__btn${moreActive || moreOpen ? ' is-active' : ''}`}
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
            >
              <span className="mobile-bottom-nav__icon">
                <EllipsisOutlined />
              </span>
              <span className="mobile-bottom-nav__label">{t('more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Drawer
        title={t('more')}
        placement="bottom"
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        height="auto"
        className="mobile-more-drawer"
        styles={{
          body: { padding: '8px 0 16px', maxHeight: 'min(70vh, 520px)', overflowY: 'auto' },
          header: { borderBottom: '1px solid var(--ant-color-border-secondary)' },
        }}
        destroyOnHidden
      >
        <SidebarNav
          items={moreItems}
          selectedKey={selectedKey}
          routeOpenGroups={[]}
          railCollapsed={false}
          onNavigate={navigate}
          icons={MORE_ICONS}
        />
      </Drawer>
    </>
  );
}

export default MobileBottomNav;
