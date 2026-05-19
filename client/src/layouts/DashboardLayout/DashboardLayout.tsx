import { Grid, Layout, theme, message } from 'antd';
import React, { useState, useCallback } from 'react';
import { LayoutHeader } from '../Header/Header';
import Navigation from '../Navigation/Navigation';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
import { useDataSources } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useQueryClient } from '@tanstack/react-query';

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
import { useTranslations } from 'next-intl';

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
      style={{
        height: '100vh',
        margin: 0,
        padding: 0,
        background: 'var(--ant-color-bg-layout)',
      }}
      hasSider
    >
      <Navigation
        collapsed={collapsed}
        isBreakpoint={isBreakpoint}
        onCollapse={setCollapsed}
        onBreakpoint={setIsBreakpoint}
      />

      {/* Mobile backdrop — sits between sidebar and content, closes sidebar on tap.
                Uses a dedicated div instead of CSS filter (filter creates a new stacking
                context that breaks position:fixed on the header). */}
      {showMobileBackdrop && (
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
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          transition: 'margin-left 0.2s ease',
          marginLeft: sidebarOffset,
          width: `calc(100% - ${sidebarOffset}px)`,
          marginTop: 0,
          padding: 0,
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        <LayoutHeader
          isBreakpoint={isBreakpoint}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          onOpenDataSourceModal={() => setShowDataSourceModal(true)}
          highlightConnectData={!dataSourcesLoading && dataSources.length === 0}
        />
        <Content
          // className="dashboard-content-override"
          style={{
            flex: 1,
            height: 'calc(100vh - 64px)',
            minHeight: '0',
            // maxHeight: 'calc(100vh - 64px)',
            margin: 0,
            marginTop: '64px',
            padding: 0,
            paddingTop: 0,
            background: 'var(--ant-color-bg-layout)',
            // display: 'flex',
            // flexDirection: 'column',
            position: 'relative',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <div
            className="page-content"
            style={{
              width: '100%',
              minHeight: '100%',
            }}
          >
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
              t('toast_ds_connected', { name: dataSource?.name ?? t('unknown') })
                        
            );
          } catch (e) {
            message.error(t('toast_refresh_datasources_failed'));
          }
        }}
        isChatIntegration={false}
      />
    </Layout>
  );
});

CustomLayout.displayName = 'CustomLayout';

export default CustomLayout;
