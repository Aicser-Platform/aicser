import { Grid, Layout, theme, message } from 'antd';
import React, { useState, useCallback } from 'react';
import { LayoutHeader } from '../Header/Header';
import Navigation from '../Navigation/Navigation';
import MobileBottomNav from '../Navigation/MobileBottomNav';
import { PageBreadcrumb } from '../Navigation/PageBreadcrumb';
import '@/layouts/Navigation/MobileBottomNav.css';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
import { useDataSources } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { OnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrap';
import { CE_ONBOARDING_AWAITING_DATA, CE_ONBOARDING_DATA_CONNECTED } from '@/components/onboarding/CeOnboardingModal';

const USER_PREFERENCES_KEY = 'userPreferences';

function getStoredLayoutSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const prefsRaw = window.localStorage.getItem(USER_PREFERENCES_KEY);
    if (prefsRaw) {
      const prefs = JSON.parse(prefsRaw);
      if (typeof prefs?.isSidebarCollapsed === 'boolean') {
        return prefs.isSidebarCollapsed;
      }
    }
    return true;
  } catch {
    return true;
  }
}

function setStoredLayoutSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const prefsRaw = window.localStorage.getItem(USER_PREFERENCES_KEY);
    const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};
    prefs.isSidebarCollapsed = collapsed;
    window.localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
}

const { useBreakpoint } = Grid;
const { Content } = Layout;

interface CustomLayoutProps {
  children: React.ReactNode;
}

const CustomLayout: React.FC<CustomLayoutProps> = React.memo(({ children }) => {
    const t = useTranslations('layout');
  const [collapsed, setCollapsed] = useState(() => getStoredLayoutSidebarCollapsed());
  const [isBreakpoint, setIsBreakpoint] = useState(false);
  const [showDataSourceModal, setShowDataSourceModal] = useState(false);
  const { dataSources, isLoading: dataSourcesLoading } = useDataSources();
  const failedDataSourcesCount = React.useMemo(
    () => dataSources.filter((ds) => ds.connection_status === 'failed').length,
    [dataSources]
  );
  const { select: contextSelectDataSource } = useDataSourceStore();
  const qc = useQueryClient();
  const refreshDataSources = () => qc.invalidateQueries({ queryKey: ['data-sources'] });

  const screens = useBreakpoint();

  // After onboarding: prompt first-time users to connect a data source (auto-open modal once when they have none)
  React.useEffect(() => {
    if (dataSourcesLoading || dataSources.length > 0) return;
    try {
      if (sessionStorage.getItem('onboarding_just_completed') === 'true') {
        sessionStorage.removeItem('onboarding_just_completed');
        const t = setTimeout(() => setShowDataSourceModal(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [dataSourcesLoading, dataSources.length]);

  React.useEffect(() => {
    setIsBreakpoint(!screens.lg);
    if (!screens.lg) {
      setCollapsed(true);
      return;
    }
    setCollapsed(getStoredLayoutSidebarCollapsed());
  }, [screens]);

  React.useEffect(() => {
    if (!isBreakpoint) {
      setStoredLayoutSidebarCollapsed(collapsed);
    }
  }, [collapsed, isBreakpoint]);

  const sidebarOffset = React.useMemo(() => (isBreakpoint ? 0 : collapsed ? 80 : 256), [collapsed, isBreakpoint]);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarOffset}px`);
  }, [sidebarOffset]);

  // On mobile, tapping the backdrop closes the sidebar
  const handleBackdropClick = useCallback(() => {
    if (isBreakpoint && !collapsed) {
      setCollapsed(true);
    }
  }, [isBreakpoint, collapsed]);

  // Show backdrop overlay when sidebar is open on mobile
  const showMobileBackdrop = isBreakpoint && !collapsed;

  return (
    <Layout
      className={isBreakpoint ? 'layout-app-shell layout--mobile-nav' : 'layout-app-shell'}
      style={{
        height: '100dvh',
        maxHeight: '100dvh',
        margin: 0,
        padding: 0,
        background: 'var(--ant-color-bg-layout)',
        overflow: 'hidden',
      }}
      hasSider={!isBreakpoint}
    >
      {!isBreakpoint && (
        <React.Suspense fallback={null}>
          <Navigation
            collapsed={collapsed}
            isBreakpoint={isBreakpoint}
            onCollapse={setCollapsed}
            onBreakpoint={setIsBreakpoint}
          />
        </React.Suspense>
      )}

      {isBreakpoint && <MobileBottomNav />}

      {/* Desktop sidebar backdrop only (mobile uses bottom nav + more drawer) */}
      {showMobileBackdrop && !isBreakpoint && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={handleBackdropClick}
          style={{
            position: 'fixed',
            top: 64 /* Below header */,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: 999 /* Below sidebar (1000), below header (1001) */,
            cursor: 'pointer',
            transition: 'opacity 0.25s ease',
          }}
          aria-hidden="true"
        />
      )}

      <Layout
        className="layout-main-column"
        style={{
          height: '100dvh',
          maxHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          marginTop: 0,
          padding: 0,
          background: 'var(--ant-color-bg-layout)',
          overflow: 'hidden',
        }}
      >
        <LayoutHeader
          isBreakpoint={isBreakpoint}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          onOpenDataSourceModal={() => setShowDataSourceModal(true)}
          highlightConnectData={!dataSourcesLoading && dataSources.length === 0}
          failedDataSourcesCount={failedDataSourcesCount}
        />
        <Content
          id="main-content"
          tabIndex={-1}
          className={`layout-page-content${isBreakpoint ? ' layout-main-content' : ''}`}
          style={{
            flex: 1,
            minHeight: 0,
            margin: 0,
            padding: 0,
            background: 'var(--ant-color-bg-layout)',
            position: 'relative',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            width: '100%',
            overflowY: 'hidden',
            overflowX: 'hidden',
          }}
        >
          <div
            className="page-content"
            style={{
              width: '100%',
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <React.Suspense fallback={null}>
              <PageBreadcrumb />
            </React.Suspense>
            {children}
          </div>
        </Content>
      </Layout>

      <UniversalDataSourceModal
        isOpen={showDataSourceModal}
        onClose={() => setShowDataSourceModal(false)}
        onDataSourceCreated={async (dataSource: any) => {
          setShowDataSourceModal(false);
          try {
            await refreshDataSources();
            if (dataSource?.id) {
              contextSelectDataSource(dataSource.id);
            }
            message.success(
              t('toast_ds_connected', { name: dataSource?.name ?? t('unknown') }),
            );
            try {
              if (sessionStorage.getItem(CE_ONBOARDING_AWAITING_DATA) === '1') {
                window.dispatchEvent(new CustomEvent(CE_ONBOARDING_DATA_CONNECTED));
              }
            } catch {
              /* ignore */
            }
          } catch {
            message.error(t('toast_refresh_datasources_failed'));
          }
        }}
        isChatIntegration={false}
      />
      <OnboardingBootstrap onConnectData={() => setShowDataSourceModal(true)} />
    </Layout>
  );
});

CustomLayout.displayName = 'CustomLayout';

export default CustomLayout;
