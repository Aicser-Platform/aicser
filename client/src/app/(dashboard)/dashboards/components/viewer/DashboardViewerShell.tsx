'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { message, Button, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  LoadingOutlined,
  MoonOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SunOutlined,
} from '@ant-design/icons';
import AicserLogo from '@/components/ui/Logo';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useAuthStore } from '@/stores/useAuthStore';
import { DashboardFilterPanel } from '../DashboardFilterPanel';
import type { RuntimeFilter } from '../../utils/filterOperators';
import { DashboardPageTabs, type DashboardPageItem } from '../DashboardPageTabs';
import { DashboardPaletteProvider } from '../../widgets/DashboardPaletteContext';
import { isDateRuntimeFilter } from '../../utils/filterOperators';
import { DashboardViewerGrid } from './DashboardViewerGrid';
import { DashboardExecutiveBanner } from './DashboardExecutiveBanner';
import { widgetInsightsFromWidgets } from '../../utils/dashboardExecutiveMeta';
import '../AddDashboardDrawer.css';
import type { LayoutItem, WidgetInstance } from '../../stores/useDashboardStore';
import type { DashboardFilter } from '@/types/dashboard';
import { exportDashboardCanvas, printDashboardOnly } from '../../services/exportDashboardService';
import { exportCSV } from '../../services/exportChartDataService';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { shouldApplyWatermark } from '@/utils/watermark';
import { isEmbedChromeHidden } from '../../utils/isEmbedChromeHidden';
import { navigateToStudio } from '../../utils/studioNavigation';
import { AUTO_REFRESH_INTERVAL_OPTIONS } from '../../hooks/useDashboardRefresh';
import { menuItemWithDescription } from '@/components/Feed/MenuItemWithDescription';

export type DashboardViewerMeta = {
  id: string;
  title: string;
  description?: string;
  keyInsight?: string;
  storyArc?: string;
  /** The dashboard's own default chart palette (config.default_color_palette). */
  colorPalette?: string;
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
  fetchFilterFieldStats: (
    field: string,
    dataSourceId: string,
    ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string }
  ) => Promise<{ min?: unknown; max?: unknown }>;
  variant?: 'shared' | 'embed';
  /** 0 = auto-refresh off; matches studio interval options when `onAutoRefreshIntervalChange` is set. */
  autoRefreshMinutes?: number;
  onAutoRefreshIntervalChange?: (minutes: number) => void;
  lastRefreshedLabel?: string;
  /** Embed only: what visitors may save (the embed's download setting). Default none. */
  download?: 'none' | 'image' | 'data';
  /** Embed only: an export the host page asked for (SDK exportImage); a new nonce runs it. */
  exportRequest?: { format: 'png' | 'pdf'; nonce: number } | null;
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
  fetchFilterFieldStats,
  variant = 'shared',
  autoRefreshMinutes = 0,
  onAutoRefreshIntervalChange,
  lastRefreshedLabel,
  download = 'none',
  exportRequest = null,
}: Props) {
  const t = useTranslations('dashboard_viewer');
  const td = useTranslations('dashboards');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDarkMode, setIsDarkMode } = useThemeMode();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { planType } = useSubscriptionStore();
  const exportBranding = shouldApplyWatermark(planType);
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

  const [exportBusy, setExportBusy] = useState(false);

  const handleExport = useCallback(
    async (format: 'png' | 'pdf' | 'print') => {
      if (exportBusy) return;
      const preparingKey =
        format === 'pdf'
          ? 'export_preparing_pdf'
          : format === 'print'
            ? 'export_preparing_print'
            : 'export_preparing_png';
      const hide = message.loading(t(preparingKey), 0);
      setExportBusy(true);
      try {
        const common = {
          filename: meta.title,
          title: meta.title,
          subtitle: (meta.description || '').trim() || undefined,
          selector: '.dashboard-viewer-canvas',
          branding: exportBranding,
          matchTheme: true as const,
        };
        if (format === 'print') {
          await printDashboardOnly(common);
          message.success(t('export_print_ok'));
        } else {
          await exportDashboardCanvas(format, common);
          message.success(format === 'pdf' ? t('export_pdf_ok') : t('export_png_ok'));
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('export_failed'));
      } finally {
        hide();
        setExportBusy(false);
      }
    },
    [meta.title, meta.description, t, exportBranding, exportBusy]
  );

  const exportMenuItems: MenuProps['items'] = [
    {
      key: 'png',
      icon: <FileImageOutlined />,
      label: menuItemWithDescription(t('export_png'), t('export_png_desc')),
      disabled: exportBusy,
      onClick: () => void handleExport('png'),
    },
    {
      key: 'pdf',
      icon: <FilePdfOutlined />,
      label: menuItemWithDescription(t('export_pdf'), t('export_pdf_desc')),
      disabled: exportBusy,
      onClick: () => void handleExport('pdf'),
    },
    {
      key: 'print',
      icon: <PrinterOutlined />,
      label: menuItemWithDescription(t('export_print'), t('export_print_desc')),
      disabled: exportBusy,
      onClick: () => void handleExport('print'),
    },
  ];

  const exportRef = useRef(handleExport);
  useEffect(() => {
    exportRef.current = handleExport;
  });
  useEffect(() => {
    if (!exportRequest || variant !== 'embed' || download === 'none') return;
    void exportRef.current(exportRequest.format);
  }, [exportRequest, variant, download]);

  // Embedded: nothing to save unless the embed's owner allowed it. Pictures show only what's
  // on screen; data is each chart's own result (summarised, capped, and filtered the same way
  // the embed is), never the table behind it.
  const embedDownloadItems = ((): NonNullable<MenuProps['items']> => {
    if (variant !== 'embed' || download === 'none') return [];
    const items: NonNullable<MenuProps['items']> = [
      exportMenuItems[0],
      exportMenuItems[1],
    ].filter(Boolean) as NonNullable<MenuProps['items']>;
    if (download === 'data') {
      const withData = widgets.filter((w) => w.chartData != null && !w.error && w.title);
      if (withData.length) {
        items.push({
          type: 'group',
          label: t('embed_download_data'),
          children: withData.map((w) => ({
            key: `csv:${w.id}`,
            icon: <FileExcelOutlined />,
            label: w.title,
            onClick: () => {
              try {
                exportCSV(w.chartData, w.title || 'chart-data', w);
              } catch (err) {
                message.error(err instanceof Error ? err.message : t('export_failed'));
              }
            },
          })),
        });
      }
    }
    return items;
  })();

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
                  <Tooltip
                    title={
                      lastRefreshedLabel
                        ? `${td('refresh_data')} · ${lastRefreshedLabel}`
                        : td('refresh_data')
                    }
                  >
                    <Button
                      type="text"
                      size="small"
                      className="icon-only-btn shared-dashboard-refresh-trigger"
                      icon={<ReloadOutlined spin={refreshing} />}
                      disabled={refreshing}
                      aria-haspopup="menu"
                      aria-label={td('refresh_menu_aria')}
                    />
                  </Tooltip>
                </Dropdown>
              </div>
            )}
            <Dropdown menu={{ items: exportMenuItems }} trigger={['click']} disabled={exportBusy}>
              <Tooltip title={t('export_menu_tooltip')}>
                <button
                  type="button"
                  className="shared-dashboard-theme-btn"
                  disabled={exportBusy}
                  aria-label={t('export_menu')}
                  aria-haspopup="menu"
                >
                  {exportBusy ? <LoadingOutlined spin /> : <DownloadOutlined />}
                </button>
              </Tooltip>
            </Dropdown>
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

      {embedDownloadItems && embedDownloadItems.length > 0 ? (
        <div className="embed-download-trigger no-print">
          <Dropdown menu={{ items: embedDownloadItems }} trigger={['click']} disabled={exportBusy} placement="bottomRight">
            <Tooltip title={t('export_menu')}>
              <Button
                size="small"
                shape="circle"
                icon={exportBusy ? <LoadingOutlined spin /> : <DownloadOutlined />}
                aria-label={t('export_menu')}
                aria-haspopup="menu"
              />
            </Tooltip>
          </Dropdown>
        </div>
      ) : null}

      <main className="shared-dashboard-content">
        {(meta.keyInsight || meta.storyArc || widgetInsights.length > 0) && (
          <DashboardExecutiveBanner
            keyInsight={meta.keyInsight}
            storyArc={meta.storyArc}
            widgetInsights={widgetInsights}
            dashboardId={dashboardId}
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

          {hasConfiguredFilters ? (
            <div className="shared-dashboard-filters">
              <DashboardFilterPanel
                variant="toolbar"
                filters={combinedFiltersConfig}
                runtimeFilters={runtimeFilters}
                onChange={onRuntimeFiltersChange}
                fetchOptions={fetchFilterOptions}
                fetchFieldStats={fetchFilterFieldStats}
                minimal
                showHeader={false}
                onClearAll={() => onRuntimeFiltersChange([])}
                onRefresh={onManualRefresh}
                refreshing={refreshing}
              />
            </div>
          ) : null}
        </div>

        {dataFreshnessHint && (
          <p className="dashboard-data-freshness no-print" role="status">
            {t('data_as_of', { when: dataFreshnessHint })}
          </p>
        )}

        <div className="dashboard-workspace dashboard-workspace-viewer">
          <div className="dashboard-workspace-main">
            <DashboardPaletteProvider palette={meta.colorPalette}>
              <DashboardViewerGrid
                widgets={widgets}
                layout={layout}
                dashboardId={dashboardId}
                runtimeFilters={runtimeFilters}
                onCrossFilter={onCrossFilter}
                onRetryWidget={onRetryWidget}
                onClearDateFilters={() => onRuntimeFiltersChange(runtimeFilters.filter((f) => !isDateRuntimeFilter(f)))}
                refreshing={refreshing}
                canvasMinHeight={hideChrome ? '100vh' : 'auto'}
              />
            </DashboardPaletteProvider>
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
