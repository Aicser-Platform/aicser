'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { message, Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  DownOutlined,
  MoonOutlined,
  ReloadOutlined,
  SunOutlined,
} from '@ant-design/icons';
import AicserLogo from '@/components/ui/Logo';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useAuthStore } from '@/stores/useAuthStore';
import { DashboardFilterPanel } from '../DashboardFilterPanel';
import type { RuntimeFilter } from '../utils/filterOperators';
import { DashboardPageTabs, type DashboardPageItem } from '../DashboardPageTabs';
import { DashboardViewerGrid } from './DashboardViewerGrid';
import { DashboardExecutiveBanner } from './DashboardExecutiveBanner';
import { widgetInsightsFromWidgets } from '../../utils/dashboardExecutiveMeta';
import '../AddDashboardDrawer.css';
import type { LayoutItem, WidgetInstance } from '../../stores/useDashboardStore';
import type { DashboardFilter } from '@/types/dashboard';
import { exportDashboardCanvas } from '../../services/exportDashboardService';
import { isEmbedChromeHidden } from '../../utils/isEmbedChromeHidden';
import { navigateToStudio } from '../../utils/studioNavigation';
import { AUTO_REFRESH_INTERVAL_OPTIONS } from '../../hooks/useDashboardRefresh';

export type DashboardViewerMeta = {
  id: string;
  title: string;
  description?: string;
  keyInsight?: string;
  storyArc?: string;
};

type Props = {
  meta: DashboardViewerMeta;
  pages: DashboardPageItem[];
  activePageId: string | null;
  onPageSelect: (pageId: string) => void;
  combinedFiltersConfig: DashboardFilter[];
  pageFilterFields?: string[];
  runtimeFilters: RuntimeFilter[];
  onRuntimeFiltersChange: (filters: RuntimeFilter[]) => void;
  onCrossFilter: (field: string, value: unknown) => void;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  dashboardId: string;
  onRetryWidget?: (widgetId: string) => void;
  onManualRefresh?: () => void;
  refreshing?: boolean;
  fetchFilterOptions: (
    field: string,
    dataSourceId: string,
    ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string }
  ) => Promise<unknown[]>;
  variant?: 'shared' | 'embed';
  /** 0 = auto-refresh off; matches studio interval options when `onAutoRefreshIntervalChange` is set. */
  autoRefreshMinutes?: number;
  onAutoRefreshIntervalChange?: (minutes: number) => void;
  lastRefreshedLabel?: string;
};

function ViewerLoading({ title, message: msg }: { title: string; message?: string }) {
  return (
    <div className="shared-dashboard-loading">
      <div className="shared-dashboard-loading-spinner" />
      <div className="shared-dashboard-error-title">{title}</div>
      {msg ? <div className="shared-dashboard-error-message">{msg}</div> : null}
    </div>
  );
}

export function DashboardViewerShell({
  meta,
  pages,
  activePageId,
  onPageSelect,
  combinedFiltersConfig,
  pageFilterFields = [],
  runtimeFilters,
  onRuntimeFiltersChange,
  onCrossFilter,
  widgets,
  layout,
  dashboardId,
  onRetryWidget,
  onManualRefresh,
  refreshing = false,
  fetchFilterOptions,
  variant = 'shared',
  autoRefreshMinutes = 0,
  onAutoRefreshIntervalChange,
  lastRefreshedLabel,
}: Props) {
  const t = useTranslations('dashboard_viewer');
  const td = useTranslations('dashboards');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDarkMode, setIsDarkMode } = useThemeMode();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hideChrome = variant === 'embed' || isEmbedChromeHidden(searchParams);
  const refreshRef = useRef(onManualRefresh);
  refreshRef.current = onManualRefresh;
  const widgetInsights = useMemo(() => widgetInsightsFromWidgets(widgets), [widgets]);
  const hasConfiguredFilters = combinedFiltersConfig.length > 0;
  const dataFreshnessHint =
    lastRefreshedLabel && autoRefreshMinutes === 0 ? lastRefreshedLabel : null;

  useEffect(() => {
    if (!autoRefreshMinutes || !refreshRef.current) return;
    const ms = autoRefreshMinutes * 60 * 1000;
    const id = window.setInterval(() => refreshRef.current?.(), ms);
    return () => window.clearInterval(id);
  }, [autoRefreshMinutes]);

  const refreshDropdownItems: NonNullable<MenuProps['items']> = [
    {
      key: '__refresh_now__',
      icon: <ReloadOutlined spin={refreshing} />,
      label: td('refresh_now_action'),
      disabled: refreshing,
    },
  ];
  if (onAutoRefreshIntervalChange) {
    refreshDropdownItems.push({ type: 'divider' });
    refreshDropdownItems.push(
      ...AUTO_REFRESH_INTERVAL_OPTIONS.map((minutes) => ({
        key: `interval:${minutes}`,
        label: minutes === 0 ? td('refresh_auto_off') : td('refresh_auto_every', { minutes }),
      })),
    );
  }

  const handleRefreshMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === '__refresh_now__') {
      onManualRefresh?.();
      return;
    }
    if (key.startsWith('interval:') && onAutoRefreshIntervalChange) {
      const minutes = Number(key.slice('interval:'.length));
      if (!Number.isNaN(minutes)) {
        onAutoRefreshIntervalChange(minutes);
      }
    }
  };

  const refreshMenuSelectedKeys = onAutoRefreshIntervalChange
    ? [`interval:${autoRefreshMinutes}`]
    : [];

  const handleExport = useCallback(
    async (format: 'png' | 'pdf') => {
      try {
        await exportDashboardCanvas(format, {
          filename: meta.title,
          selector: '.dashboard-viewer-canvas',
        });
        message.success(format === 'pdf' ? t('export_pdf_ok') : t('export_png_ok'));
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('export_failed'));
      }
    },
    [meta.title, t]
  );

  const goHome = useCallback(() => {
    if (isAuthenticated) {
      navigateToStudio(meta.id, activePageId);
    } else {
      router.push('/login');
    }
  }, [isAuthenticated, router, meta.id, activePageId]);

  return (
    <div
      className={`shared-dashboard-container ${hideChrome ? 'embed-chrome-hidden' : ''}`}
      id="dashboard-viewer-root"
    >
      {!hideChrome && (
        <header className="shared-dashboard-header no-print">
          <div className="shared-dashboard-header-left">
            <button type="button" className="shared-dashboard-logo-btn" onClick={goHome} aria-label={t('go_home')}>
              <AicserLogo size={32} showText />
            </button>
            <div className="shared-dashboard-header-divider" aria-hidden />
            <div className="shared-dashboard-title-block">
              <h1 className="shared-dashboard-title">{meta.title}</h1>
              {meta.description ? <p className="shared-dashboard-subtitle">{meta.description}</p> : null}
            </div>
          </div>
          <div className="shared-dashboard-header-right">
            {onManualRefresh && (
              <div className="shared-dashboard-refresh-wrap">
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: refreshDropdownItems,
                    selectedKeys: refreshMenuSelectedKeys,
                    onClick: handleRefreshMenuClick,
                  }}
                >
                  <Button
                    size="small"
                    className="studio-context-btn studio-refresh-dropdown-trigger shared-dashboard-refresh-trigger"
                    disabled={refreshing}
                    aria-haspopup="menu"
                    aria-label={td('refresh_menu_aria')}
                    title={td('refresh_tooltip')}
                  >
                    <ReloadOutlined spin={refreshing} />
                    <span className="studio-refresh-trigger-text">
                      <span className="studio-refresh-trigger-title">{td('refresh_data')}</span>
                      {lastRefreshedLabel ? (
                        <span className="studio-refresh-trigger-updated">{lastRefreshedLabel}</span>
                      ) : null}
                    </span>
                    <DownOutlined className="studio-refresh-trigger-caret" />
                  </Button>
                </Dropdown>
              </div>
            )}
            <button
              type="button"
              className="shared-dashboard-theme-btn"
              onClick={() => void handleExport('png')}
              title={t('export_png')}
              aria-label={t('export_png')}
            >
              <DownloadOutlined />
            </button>
            <button
              type="button"
              className="shared-dashboard-theme-btn"
              onClick={() => setIsDarkMode(!isDarkMode)}
              aria-label={isDarkMode ? t('light_mode') : t('dark_mode')}
            >
              {isDarkMode ? <SunOutlined /> : <MoonOutlined />}
            </button>
            {isAuthenticated && (
              <button type="button" className="shared-dashboard-go-to-base-btn" onClick={goHome}>
                <AppstoreOutlined />
                <span className="btn-label">{t('go_to_studio')}</span>
              </button>
            )}
          </div>
        </header>
      )}

      <main className="shared-dashboard-content">
        {(meta.keyInsight || meta.storyArc || widgetInsights.length > 0) && (
          <DashboardExecutiveBanner
            keyInsight={meta.keyInsight}
            storyArc={meta.storyArc}
            widgetInsights={widgetInsights}
          />
        )}

        <div className="shared-dashboard-toolbar no-print">
          {pages.length > 1 && (
            <DashboardPageTabs
              pages={pages}
              activePageId={activePageId}
              onSelect={onPageSelect}
              onCreate={async () => {}}
              onRename={async () => {}}
              onDelete={async () => {}}
              readOnly
            />
          )}
        </div>

        {dataFreshnessHint && (
          <p className="dashboard-data-freshness no-print" role="status">
            {t('data_as_of', { when: dataFreshnessHint })}
          </p>
        )}

        {hasConfiguredFilters ? (
          <div className="dashboard-filter-toolbar-strip">
            <DashboardFilterPanel
              variant="toolbar"
              filters={combinedFiltersConfig}
              runtimeFilters={runtimeFilters}
              onChange={onRuntimeFiltersChange}
              fetchOptions={fetchFilterOptions}
              minimal
              showHeader={false}
              onClearAll={() => onRuntimeFiltersChange([])}
            />
          </div>
        ) : null}

        <div className="dashboard-workspace dashboard-workspace-viewer">
          <div className="dashboard-workspace-main">
            <DashboardViewerGrid
              widgets={widgets}
              layout={layout}
              dashboardId={dashboardId}
              runtimeFilters={runtimeFilters}
              onCrossFilter={onCrossFilter}
              onRetryWidget={onRetryWidget}
              refreshing={refreshing}
              canvasMinHeight={hideChrome ? '100vh' : undefined}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export function DashboardViewerError({
  title,
  message: msg,
  onAction,
  actionLabel,
}: {
  title: string;
  message: string;
  onAction: () => void;
  actionLabel?: string;
}) {
  const t = useTranslations('dashboard_viewer');
  return (
    <div className="shared-dashboard-error">
      <div className="shared-dashboard-error-icon">
        <ExclamationCircleOutlined />
      </div>
      <div className="shared-dashboard-error-title">{title}</div>
      <div className="shared-dashboard-error-message">{msg}</div>
      <button type="button" className="shared-dashboard-back-btn" onClick={onAction}>
        {actionLabel || t('go_home')}
      </button>
    </div>
  );
}

export { ViewerLoading };

export default DashboardViewerShell;
