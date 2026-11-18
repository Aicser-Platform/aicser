'use client';

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AppHeader } from '@/components/app-shell/AppHeader';
import { AppSidebar } from '@/components/app-shell/AppSidebar';
import { MobileNav } from '@/components/app-shell/MobileNav';
import { SidebarProvider } from '@/components/aicser-ui/sidebar';
import { Toaster } from '@/components/aicser-ui/sonner';
import { TooltipProvider } from '@/components/aicser-ui/tooltip';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
import { OnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrap';
import { CE_ONBOARDING_AWAITING_DATA, CE_ONBOARDING_DATA_CONNECTED } from '@/components/onboarding/CeOnboardingModal';
import { useDataSources } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import '@/styles/aicser-ui.css';
import '@/styles/app-shell.css';

const USER_PREFERENCES_KEY = 'userPreferences';
/** Below this the sidebar gives way to the tab bar (was antd's `lg`). */
const MOBILE_QUERY = '(max-width: 991.98px)';
/** Below this (tablets, small laptops) the sidebar starts as the icon rail. */
const COMPACT_QUERY = '(max-width: 1199.98px)';

function readSidebarCollapsed(): boolean {
  try {
    const prefs = JSON.parse(window.localStorage.getItem(USER_PREFERENCES_KEY) || '{}');
    return typeof prefs?.isSidebarCollapsed === 'boolean' ? prefs.isSidebarCollapsed : true;
  } catch {
    return true;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    const prefs = JSON.parse(window.localStorage.getItem(USER_PREFERENCES_KEY) || '{}');
    window.localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify({ ...prefs, isSidebarCollapsed: collapsed }));
  } catch {
    // only a convenience
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

interface CustomLayoutProps {
  children: React.ReactNode;
  banner?: React.ReactNode;
}

/**
 * App shell in the desktop's design (Aicser UI): sidebar · header · page, tab bar on phones. Only the chrome is
 * inside the `.aicser-ui` scope; pages render outside it, so AntD pages keep their own styles until they move over.
 */
const CustomLayout: React.FC<CustomLayoutProps> = React.memo(({ children, banner }) => {
  const t = useTranslations('layout');
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  React.useEffect(() => {
    setSidebarOpen(isCompact ? false : !readSidebarCollapsed());
  }, [isCompact]);
  const changeSidebar = React.useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      if (!isCompact) writeSidebarCollapsed(!open);
    },
    [isCompact]
  );

  const [showDataSourceModal, setShowDataSourceModal] = React.useState(false);
  const [initialType, setInitialType] = React.useState<'sample_duckdb' | undefined>(undefined);
  const { dataSources, isLoading: dataSourcesLoading } = useDataSources();
  const failedDataSourcesCount = React.useMemo(
    () => dataSources.filter((ds) => ds.connection_status === 'failed').length,
    [dataSources]
  );
  const { select: selectDataSource } = useDataSourceStore();
  const queryClient = useQueryClient();

  // Right after onboarding, someone with no data source is asked to connect one (once).
  React.useEffect(() => {
    if (dataSourcesLoading || dataSources.length > 0) return;
    try {
      if (sessionStorage.getItem('onboarding_just_completed') === 'true') {
        sessionStorage.removeItem('onboarding_just_completed');
        const id = setTimeout(() => setShowDataSourceModal(true), 800);
        return () => clearTimeout(id);
      }
    } catch {
      // storage unavailable
    }
  }, [dataSourcesLoading, dataSources.length]);

  // Any page can open the connect dialog (it lives here): window event 'aiser-open-data-source-modal'.
  React.useEffect(() => {
    const open = () => setShowDataSourceModal(true);
    window.addEventListener('aiser-open-data-source-modal', open);
    return () => window.removeEventListener('aiser-open-data-source-modal', open);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider open={sidebarOpen} onOpenChange={changeSidebar}>
        {/* Legacy class names on the chrome (layout-app-header, app-navigation-sider, layout-main-column,
            mobile-bottom-nav) are what dashboard print/export uses to hide it or let the page grow. */}
        <div
          className="flex h-dvh max-h-dvh w-full overflow-hidden"
          style={{ background: 'var(--ant-color-bg-layout)' }}
        >
          <div className="aicser-ui">{!isMobile ? <AppSidebar /> : null}</div>
          <div className="layout-main-column flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="aicser-ui">
              <AppHeader
                isMobile={isMobile}
                onOpenDataSourceModal={() => setShowDataSourceModal(true)}
                highlightConnectData={!dataSourcesLoading && dataSources.length === 0}
                failedDataSourcesCount={failedDataSourcesCount}
              />
            </div>
            {banner}
            <main
              id="main-content"
              tabIndex={-1}
              className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden outline-none"
            >
              <div className="page-content">{children}</div>
            </main>
            <div className="aicser-ui">{isMobile ? <MobileNav /> : null}</div>
          </div>
        </div>
      </SidebarProvider>

      <div className="aicser-ui">
        <Toaster />
      </div>

      <UniversalDataSourceModal
        isOpen={showDataSourceModal}
        initialDataSourceType={initialType}
        onClose={() => {
          setShowDataSourceModal(false);
          setInitialType(undefined);
        }}
        onDataSourceCreated={async (dataSource: { id?: string; name?: string } | null) => {
          setShowDataSourceModal(false);
          setInitialType(undefined);
          try {
            await queryClient.invalidateQueries({ queryKey: ['data-sources'] });
            if (dataSource?.id) selectDataSource(dataSource.id);
            toast.success(t('toast_ds_connected', { name: dataSource?.name ?? t('unknown') }));
            try {
              if (sessionStorage.getItem(CE_ONBOARDING_AWAITING_DATA) === '1') {
                window.dispatchEvent(new CustomEvent(CE_ONBOARDING_DATA_CONNECTED));
              }
            } catch {
              // storage unavailable
            }
          } catch {
            toast.error(t('toast_refresh_datasources_failed'));
          }
        }}
        isChatIntegration={false}
      />
      <OnboardingBootstrap
        onConnectData={(type) => {
          setInitialType(type);
          setShowDataSourceModal(true);
        }}
      />
    </TooltipProvider>
  );
});

CustomLayout.displayName = 'CustomLayout';

export default CustomLayout;
