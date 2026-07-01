'use client';

import React, { useEffect } from 'react';
import { Badge, Button, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { FilterOutlined, SettingOutlined, ReloadOutlined, DownOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';
import { DashboardPageTabs, type DashboardPageItem } from './DashboardPageTabs';
import type { RuntimeFilter } from '../utils/filterOperators';
import { countActiveFilterFields } from '../utils/filterOperators';
import { DashboardFiltersManageModal } from './DashboardFiltersManageModal';
import type { FilterFieldConflict } from '../utils/filterConflicts';
import type { LayoutPreset } from './LayoutPresetsMenu';
import { DashboardStyleMenu } from './DashboardStyleMenu';
import { DashboardDataModelButton } from './DashboardDataModelButton';
import { OverflowMenuButton } from './OverflowMenuButton';
import type { ChartPaletteId } from '../utils/chartPaletteCatalog';
import { AUTO_REFRESH_INTERVAL_OPTIONS } from '../hooks/useDashboardRefresh';

type Props = {
  pages: DashboardPageItem[];
  activePageId: string | null;
  defaultPageId?: string | null;
  pageTabProps: Omit<
    React.ComponentProps<typeof DashboardPageTabs>,
    'pages' | 'activePageId' | 'defaultPageId' | 'embedded'
  >;
  globalFiltersConfig: DashboardFilter[];
  pageFiltersConfig?: DashboardFilter[];
  combinedFiltersConfig?: DashboardFilter[];
  runtimeFilters: RuntimeFilter[];
  onRuntimeFiltersChange: (filters: RuntimeFilter[]) => void;
  filtersPanelOpen: boolean;
  onFiltersPanelOpenChange: (open: boolean) => void;
  filtersEditorOpen: boolean;
  onFiltersEditorOpenChange: (open: boolean) => void;
  pageFiltersEditorOpen?: boolean;
  onPageFiltersEditorOpenChange?: (open: boolean) => void;
  onSavePageFilters?: (filters: DashboardFilter[]) => Promise<void>;
  dataSourceOptions: { value: string; label: string }[];
  tableOptionsBySource?: Record<string, { value: string; label: string }[]>;
  widgetScopeOptions?: { value: string; label: string }[];
  filterFieldConflicts?: FilterFieldConflict[];
  dataSourcesForFilters?: Array<{ id: string | number; schema?: { tables?: unknown[] } }>;
  dashboardId?: string;
  studioWidgets?: import('../stores/useDashboardStore').WidgetInstance[];
  onSaveGlobalFilters: (filters: DashboardFilter[]) => Promise<void>;
  fetchFilterOptions: (field: string, dataSourceId: string, ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string }) => Promise<unknown>;
  widgetCount: number;
  onApplyLayoutPreset?: (preset: LayoutPreset) => void;
  onResetLayout?: () => void;
  hideLayout?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastRefreshedLabel?: string;
  autoRefreshMinutes?: number;
  onAutoRefreshIntervalChange?: (minutes: number) => void;
  dashboardColorPalette?: ChartPaletteId | string;
  onDashboardColorPaletteChange?: (paletteId: ChartPaletteId) => void;
  /** View mode — apply filters only; hide configure/manage affordances. */
  readOnly?: boolean;
  /** Fullscreen presentation — minimal chrome: pages, refresh, runtime filters, exit. */
  presentationMode?: boolean;
  presentationTitle?: string;
  onExitPresentation?: () => void;
  dataSourceIds?: string[];
};

export function StudioContextBar({
  pages,
  activePageId,
  defaultPageId,
  pageTabProps,
  globalFiltersConfig,
  pageFiltersConfig = [],
  combinedFiltersConfig,
  runtimeFilters,
  onRuntimeFiltersChange,
  filtersPanelOpen,
  onFiltersPanelOpenChange,
  filtersEditorOpen,
  onFiltersEditorOpenChange,
  pageFiltersEditorOpen = false,
  onPageFiltersEditorOpenChange,
  onSavePageFilters,
  dataSourceOptions,
  tableOptionsBySource = {},
  widgetScopeOptions = [],
  filterFieldConflicts = [],
  dataSourcesForFilters = [],
  dashboardId,
  studioWidgets = [],
  onSaveGlobalFilters,
  fetchFilterOptions,
  widgetCount,
  onApplyLayoutPreset,
  onResetLayout,
  hideLayout = false,
  onRefresh,
  refreshing = false,
  lastRefreshedLabel,
  autoRefreshMinutes = 0,
  onAutoRefreshIntervalChange,
  dashboardColorPalette = 'default',
  onDashboardColorPaletteChange,
  readOnly = false,
  presentationMode = false,
  presentationTitle,
  onExitPresentation,
  dataSourceIds = [],
}: Props) {
  const t = useTranslations('dashboards');

  const activeFiltersConfig = combinedFiltersConfig ?? globalFiltersConfig;
  const hasConfiguredFilters = activeFiltersConfig.length > 0;
  const activeFilterCount = countActiveFilterFields(runtimeFilters);
  const canEditPageFilters = Boolean(activePageId && onSavePageFilters && pages.length > 0);

  useEffect(() => {
    if (readOnly && hasConfiguredFilters) {
      onFiltersPanelOpenChange(true);
    }
  }, [readOnly, hasConfiguredFilters, onFiltersPanelOpenChange]);

  const handleFilterClick = () => {
    if (!hasConfiguredFilters) {
      if (!readOnly) {
        onFiltersEditorOpenChange(true);
      }
      return;
    }
    onFiltersPanelOpenChange(!filtersPanelOpen);
  };

  const filterMenuItems: MenuProps['items'] = readOnly
    ? [
        ...(hasConfiguredFilters
          ? [
              {
                key: 'toggle',
                label: filtersPanelOpen ? t('hide_filters') : t('show_filters'),
                onClick: () => onFiltersPanelOpenChange(!filtersPanelOpen),
              },
            ]
          : []),
        ...(activeFilterCount > 0
          ? [
              ...(hasConfiguredFilters ? [{ type: 'divider' as const }] : []),
              {
                key: 'clear',
                label: t('clear_filters'),
                onClick: () => onRuntimeFiltersChange([]),
              },
            ]
          : []),
      ]
    : [
        {
          key: 'configure',
          icon: <SettingOutlined />,
          label: t('manage_filters'),
          onClick: () => {
            onPageFiltersEditorOpenChange?.(false);
            onFiltersEditorOpenChange(true);
          },
        },
        ...(canEditPageFilters
          ? [
              {
                key: 'configure-page',
                icon: <SettingOutlined />,
                label: t('manage_page_filters'),
                onClick: () => {
                  onPageFiltersEditorOpenChange?.(true);
                  onFiltersEditorOpenChange(true);
                },
              },
            ]
          : []),
        ...(hasConfiguredFilters
          ? [
              {
                key: 'toggle',
                label: filtersPanelOpen ? t('hide_filters') : t('show_filters'),
                onClick: () => onFiltersPanelOpenChange(!filtersPanelOpen),
              },
            ]
          : []),
        ...(activeFilterCount > 0
          ? [
              { type: 'divider' as const },
              {
                key: 'clear',
                label: t('clear_filters'),
                onClick: () => onRuntimeFiltersChange([]),
              },
            ]
          : []),
      ];

  const refreshDropdownItems: NonNullable<MenuProps['items']> = [
    {
      key: '__refresh_now__',
      icon: <ReloadOutlined spin={refreshing} />,
      label: t('refresh_now_action'),
      disabled: refreshing,
    },
  ];
  if (onAutoRefreshIntervalChange) {
    refreshDropdownItems.push({ type: 'divider' });
    refreshDropdownItems.push(
      ...AUTO_REFRESH_INTERVAL_OPTIONS.map((minutes) => ({
        key: `interval:${minutes}`,
        label: minutes === 0 ? t('refresh_auto_off') : t('refresh_auto_every', { minutes }),
      })),
    );
  }

  const handleRefreshMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === '__refresh_now__') {
      onRefresh?.();
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

  return (
    <div className={`studio-context${presentationMode ? ' studio-context-presentation' : ''}`}>
      <div className="studio-context-row flex items-center justify-between gap-3 flex-wrap">
        <div className="studio-context-pages flex-1 min-w-0">
          <DashboardPageTabs
            pages={pages}
            activePageId={activePageId}
            defaultPageId={defaultPageId}
            embedded
            {...pageTabProps}
          />
        </div>

        <div className="studio-context-actions flex items-center gap-2 shrink-0">
          {onRefresh && !presentationMode && (
            <div className="studio-refresh-group flex items-center gap-1.5 shrink-0">
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
                      ? `${t('refresh_data')} · ${lastRefreshedLabel}`
                      : t('refresh_data')
                  }
                >
                  <Button
                    size="small"
                    className="studio-context-btn studio-refresh-dropdown-trigger"
                    icon={<ReloadOutlined spin={refreshing} />}
                    disabled={refreshing}
                    aria-haspopup="menu"
                    aria-label={t('refresh_menu_aria')}
                  />
                </Tooltip>
              </Dropdown>
            </div>
          )}

          {!readOnly && !presentationMode && (
          <Button.Group>
            <Tooltip
              title={
                hasConfiguredFilters
                  ? t('filter_tooltip_apply')
                  : t('filter_tooltip_configure')
              }
            >
              <Button
                size="small"
                type={filtersPanelOpen && hasConfiguredFilters ? 'primary' : 'default'}
                ghost={filtersPanelOpen && hasConfiguredFilters}
                icon={<FilterOutlined />}
                className="text-xs"
                onClick={handleFilterClick}
              >
                {t('filter_verb')}
                {activeFilterCount > 0 && (
                  <Badge count={activeFilterCount} size="small" className="!ml-1.5" />
                )}
              </Button>
            </Tooltip>
            <Dropdown menu={{ items: filterMenuItems }} trigger={['click']}>
              <Button size="small" icon={<DownOutlined />} className="!px-1.5 text-xs" />
            </Dropdown>
          </Button.Group>
          )}

          <>
            {!presentationMode && onDashboardColorPaletteChange ? (
              <DashboardStyleMenu
                currentPalette={dashboardColorPalette}
                hideLayout={hideLayout}
                widgetCount={widgetCount}
                onApplyLayoutPreset={onApplyLayoutPreset}
                onResetLayout={onResetLayout}
                onPaletteChange={onDashboardColorPaletteChange}
              />
            ) : null}
          </>

          {presentationMode && onExitPresentation ? (
            <Tooltip title={t('exit_fullscreen')}>
              <Button
                size="small"
                type="text"
                className="!w-8 !h-8 !p-0 !rounded-md shrink-0 text-text-secondary hover:!text-text hover:!bg-bg-elevated"
                icon={<FullscreenExitOutlined />}
                onClick={onExitPresentation}
                aria-label={t('exit_fullscreen')}
              />
            </Tooltip>
          ) : null}

          {!readOnly ? (
          <DashboardFiltersManageModal
            open={filtersEditorOpen || pageFiltersEditorOpen}
            onClose={() => {
              onFiltersEditorOpenChange(false);
              onPageFiltersEditorOpenChange?.(false);
            }}
            initialTab={pageFiltersEditorOpen ? 'page' : 'global'}
            globalFilters={globalFiltersConfig}
            pageFilters={pageFiltersConfig}
            onSaveGlobal={onSaveGlobalFilters}
            onSavePage={onSavePageFilters}
            canEditPageFilters={canEditPageFilters}
            dataSourceOptions={dataSourceOptions}
            tableOptionsBySource={tableOptionsBySource}
            widgetScopeOptions={widgetScopeOptions}
            dataSources={dataSourcesForFilters}
            dashboardId={dashboardId}
            widgets={studioWidgets}
          />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default StudioContextBar;
