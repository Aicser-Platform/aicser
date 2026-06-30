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
      className={
        isPanel
          ? `flex-shrink-0 flex flex-col bg-bg-container overflow-hidden border-l transition-[width,border-color,background-color] duration-200 ${
              open ? 'w-[280px] border-border-light' : 'w-0 border-transparent'
            }`
          : 'flex-shrink-0 flex flex-col bg-transparent overflow-hidden w-full border-t border-border-light pt-2.5 pb-3'
      }
      aria-label={t('dashboard_filter_strip_aria')}
    >
      {showHeader && isPanel && (
        <header
          className={`flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5 border-b border-border-light shrink-0 transition-opacity duration-150 ${
            open ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <span className="text-[13px] font-bold tracking-wide text-text">{t('filter_panel_title')}</span>
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
      <div
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden transition-opacity duration-150 ${
          isPanel ? 'px-3.5 pb-3.5' : 'p-0 !overflow-visible'
        } ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden={!open}
      >
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
