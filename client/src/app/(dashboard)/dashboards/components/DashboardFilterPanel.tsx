'use client';

import React from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';
import { GlobalFiltersBar, type FilterBarLayout } from './GlobalFiltersBar';
import type { RuntimeFilter } from '../utils/filterOperators';

type Props = {
  filters: DashboardFilter[];
  runtimeFilters: RuntimeFilter[];
  onChange: (filters: RuntimeFilter[]) => void;
  fetchOptions?: (
    field: string,
    dataSourceId: string,
    ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
  ) => Promise<unknown>;
  variant?: FilterBarLayout;
  minimal?: boolean;
  onClearAll?: () => void;
  onClose?: () => void;
  showHeader?: boolean;
  open?: boolean;
};

/**
 * Report filters — side panel (default) or horizontal toolbar (fullscreen).
 * Canvas slicers remain on the grid; this hosts dashboard/page filters only.
 */
export function DashboardFilterPanel({
  filters,
  runtimeFilters,
  onChange,
  fetchOptions,
  variant = 'panel',
  minimal = false,
  onClearAll,
  onClose,
  showHeader = true,
  open = true,
}: Props) {
  const t = useTranslations('dashboards');

  if (!filters.length) return null;

  const isPanel = variant === 'panel';

  return (
    <aside
      className={`dashboard-filter-panel dashboard-filter-panel--${variant} ${open ? 'is-open' : 'is-closed'}`}
      aria-label={t('dashboard_filter_strip_aria')}
    >
      {showHeader && isPanel && (
        <header className="dashboard-filter-panel-header">
          <span className="dashboard-filter-panel-title">{t('filter_panel_title')}</span>
          {onClose && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label={t('hide_filters')}
              onClick={onClose}
            />
          )}
        </header>
      )}
      <div className="dashboard-filter-panel-body" aria-hidden={!open}>
        <GlobalFiltersBar
          filters={filters}
          runtimeFilters={runtimeFilters}
          onChange={onChange}
          fetchOptions={fetchOptions}
          layout={variant}
          minimal={minimal}
          onClearAll={onClearAll}
        />
      </div>
    </aside>
  );
}

export default DashboardFilterPanel;
