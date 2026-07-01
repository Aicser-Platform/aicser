'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { ClearOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';
import { resolveDatePresets } from '../utils/dateFilterPresets';
import { type RuntimeFilter } from '../utils/filterOperators';
import {
  FilterDateRangeField,
  FilterSingleDateField,
  FilterNumericRangeField,
  FilterSelectField,
  FilterSearchField,
} from './filterFields';
import { useFilterOptionsLoader } from '../hooks/useFilterOptionsLoader';

export type FilterBarLayout = 'panel' | 'toolbar';

type FilterRowProps = {
  filter: DashboardFilter;
  runtimeFilters: RuntimeFilter[];
  layout: FilterBarLayout;
  fetchOptions?: Props['fetchOptions'];
  fetchFieldStats?: Props['fetchFieldStats'];
  onChange: (filters: RuntimeFilter[]) => void;
  searchDraft: string;
  onSearchDraft: (field: string, value: string) => void;
};

function ReportFilterRow({
  filter,
  runtimeFilters,
  layout,
  fetchOptions,
  fetchFieldStats,
  onChange,
  searchDraft,
  onSearchDraft,
}: FilterRowProps) {
  const t = useTranslations('dashboards');
  const datePresets = useMemo(() => resolveDatePresets(t), [t]);
  const label = filter.name?.trim() || filter.field;
  const needsOptions = filter.type === 'dropdown' || filter.type === 'checkbox';
  const { options, loading } = useFilterOptionsLoader(
    filter.field,
    filter.dataSourceId,
    needsOptions ? fetchOptions : undefined,
    runtimeFilters,
    { tableName: filter.tableName, id: filter.id, staticOptions: filter.options, enabled: needsOptions },
  );
  const [fieldStats, setFieldStats] = useState<{ min?: unknown; max?: unknown }>({});

  useEffect(() => {
    if (layout !== 'toolbar' || filter.type !== 'dateRange' || !fetchFieldStats || !filter.field || !filter.dataSourceId) {
      setFieldStats({});
      return;
    }
    let cancelled = false;
    fetchFieldStats(filter.field, filter.dataSourceId, {
      tableName: filter.tableName,
      runtimeFilters,
      excludeField: filter.field,
    })
      .then((stats) => {
        if (!cancelled) setFieldStats(stats || {});
      })
      .catch(() => {
        if (!cancelled) setFieldStats({});
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFieldStats, filter.dataSourceId, filter.field, filter.tableName, filter.type, layout, runtimeFilters]);

  const removeField = (field: string) => runtimeFilters.filter((f) => f.field !== field);

  if (filter.type === 'dateRange') {
    return (
      <FilterDateRangeField
        label={label}
        field={filter.field}
        runtimeFilters={runtimeFilters}
        presets={datePresets}
        presentation={layout === 'toolbar' ? 'range' : 'presets'}
        displayRange={layout === 'toolbar' ? [fieldStats.min, fieldStats.max] : undefined}
        onChange={(from, to) => {
          const next = removeField(filter.field);
          if (from) next.push({ field: filter.field, operator: '>=', value: from, type: 'date' });
          if (to) next.push({ field: filter.field, operator: '<=', value: to, type: 'date' });
          onChange(next);
        }}
      />
    );
  }

  if (filter.type === 'date') {
    return (
      <FilterSingleDateField
        label={label}
        field={filter.field}
        runtimeFilters={runtimeFilters}
        placeholder={t('filter_pick_date')}
        onChange={(value) => {
          const next = removeField(filter.field);
          if (value) {
            next.push({ field: filter.field, operator: '>=', value, type: 'date' });
            next.push({ field: filter.field, operator: '<=', value, type: 'date' });
          }
          onChange(next);
        }}
      />
    );
  }

  if (filter.type === 'slider') {
    const boundsMin = filter.numericMin ?? 0;
    const boundsMax = filter.numericMax ?? 100;
    return (
      <FilterNumericRangeField
        label={label}
        field={filter.field}
        runtimeFilters={runtimeFilters}
        min={boundsMin}
        max={boundsMax}
        onChange={(range) => {
          const next = removeField(filter.field);
          const [lo, hi] = range;
          if (lo > boundsMin) next.push({ field: filter.field, operator: '>=', value: lo, type: 'simple' });
          if (hi < boundsMax) next.push({ field: filter.field, operator: '<=', value: hi, type: 'simple' });
          onChange(next);
        }}
      />
    );
  }

  if (filter.type === 'checkbox') {
    const currentIn = runtimeFilters.find((f) => f.field === filter.field && f.operator === 'in');
    const multiVal = Array.isArray(currentIn?.value)
      ? (currentIn!.value as string[])
      : currentIn?.value
        ? String(currentIn.value).split(',').map((s) => s.trim())
        : [];
    return (
      <FilterSelectField
        label={label}
        mode="multi"
        maxTagCount={layout === 'panel' ? 4 : 2}
        placeholder={layout === 'toolbar' ? t('filter_all_value') : t('filter_select_value')}
        options={options}
        loading={loading}
        emptyLabel={t('filter_options_empty')}
        showSearch={layout !== 'toolbar'}
        value={multiVal}
        onChange={(vals) => {
          const next = removeField(filter.field);
          const arr = Array.isArray(vals) ? vals : [];
          if (arr.length) next.push({ field: filter.field, operator: 'in', value: arr, type: 'simple' });
          onChange(next);
        }}
      />
    );
  }

  if (filter.type === 'dropdown') {
    const current = runtimeFilters.find((f) => f.field === filter.field && f.operator === '=');
    return (
      <FilterSelectField
        label={label}
        placeholder={layout === 'toolbar' ? t('filter_all_value') : t('filter_select_value')}
        options={options}
        loading={loading}
        emptyLabel={t('filter_options_empty')}
        showSearch={layout !== 'toolbar'}
        emptyOptionLabel={layout === 'toolbar' ? t('filter_all_value') : undefined}
        value={current?.value as string | undefined}
        onChange={(v) => {
          const next = removeField(filter.field);
          if (v !== undefined && v !== null && v !== '') {
            next.push({ field: filter.field, operator: '=', value: v, type: 'simple' });
          }
          onChange(next);
        }}
      />
    );
  }

  if (filter.type === 'search') {
    return (
      <FilterSearchField
        label={label}
        placeholder={t('filter_search_placeholder')}
        value={searchDraft}
        onChange={(raw) => {
          onSearchDraft(filter.field, raw);
        }}
        onCommit={(raw) => {
          const next = removeField(filter.field);
          const trimmed = raw.trim();
          if (trimmed.length >= 2) {
            next.push({ field: filter.field, operator: 'like', value: `%${trimmed}%`, type: 'search' });
          }
          onChange(next);
        }}
      />
    );
  }

  return null;
}

type Props = {
  filters: DashboardFilter[];
  runtimeFilters: RuntimeFilter[];
  onChange: (filters: RuntimeFilter[]) => void;
  fetchOptions?: (
    field: string,
    dataSourceId: string,
    ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
  ) => Promise<unknown>;
  fetchFieldStats?: (
    field: string,
    dataSourceId: string,
    ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
  ) => Promise<{ min?: unknown; max?: unknown }>;
  layout?: FilterBarLayout;
  minimal?: boolean;
  onClearAll?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function GlobalFiltersBar({
  filters,
  runtimeFilters,
  onChange,
  fetchOptions,
  fetchFieldStats,
  layout = 'panel',
  minimal = false,
  onClearAll,
  onRefresh,
  refreshing = false,
}: Props) {
  const t = useTranslations('dashboards');
  const [searchDrafts, setSearchDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setSearchDrafts((prev) => {
      const next = { ...prev };
      filters.forEach((filter) => {
        if (filter.type !== 'search') return;
        const current = runtimeFilters.find((f) => f.field === filter.field && f.operator === 'like');
        next[filter.field] =
          current?.value != null ? String(current.value).replace(/^%|%$/g, '') : '';
      });
      return next;
    });
  }, [filters, runtimeFilters]);

  if (!filters.length) return null;

  const clearAll = () => {
    setSearchDrafts({});
    onChange([]);
  };

  const hasActive = runtimeFilters.length > 0;

  const clearControl = hasActive ? (
    minimal ? (
      <Tooltip title={t('clear_filters')}>
        <Button
          type="text"
          size="small"
          icon={<ClearOutlined />}
          aria-label={t('clear_filters')}
          onClick={() => (onClearAll ? onClearAll() : clearAll())}
        />
      </Tooltip>
    ) : (
      <Button type="link" size="small" icon={<ClearOutlined />} onClick={clearAll}>
        {t('clear_filters')}
      </Button>
    )
  ) : null;

  const toolbarResetControl = (
    <Button
      type="default"
      size="small"
      icon={<ClearOutlined />}
      onClick={() => (onClearAll ? onClearAll() : clearAll())}
      disabled={!hasActive}
      className="report-filter-reset-button"
    >
      {t('reset')}
    </Button>
  );
  const toolbarRefreshControl = onRefresh ? (
    <Tooltip title={t('refresh_tooltip')}>
      <Button
        type="default"
        size="small"
        icon={<ReloadOutlined spin={refreshing} />}
        onClick={onRefresh}
        disabled={refreshing}
        className="report-filter-icon-button"
        aria-label={t('refresh_data')}
      />
    </Tooltip>
  ) : null;

  const rows = filters.map((filter) => (
    <ReportFilterRow
      key={filter.id || filter.field}
      filter={filter}
      runtimeFilters={runtimeFilters}
      layout={layout}
      fetchOptions={fetchOptions}
      fetchFieldStats={fetchFieldStats}
      onChange={onChange}
      searchDraft={searchDrafts[filter.field] ?? ''}
      onSearchDraft={(field, value) => setSearchDrafts((prev) => ({ ...prev, [field]: value }))}
    />
  ));

  if (layout === 'panel') {
    return (
      <div className="report-filter-panel">
        {filters.map((filter, index) => (
          <React.Fragment key={filter.id || filter.field}>
            {index > 0 && <hr className="report-filter-hrule" />}
            <div className="report-filter-panel-item">{rows[index]}</div>
          </React.Fragment>
        ))}
        {clearControl && (
          <>
            <hr className="report-filter-hrule" />
            <div className="report-filter-panel-footer">{clearControl}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="report-filter-toolbar">
      <div className="report-filter-toolbar-title">{t('global_filters_label')}:</div>
      <div className="report-filter-toolbar-track">
        {filters.map((filter, index) => (
          <div className="report-filter-toolbar-item" key={filter.id || filter.field}>
            {rows[index]}
          </div>
        ))}
      </div>
      <div className="report-filter-toolbar-actions">
        {toolbarRefreshControl}
        {toolbarResetControl}
      </div>
    </div>
  );
}

export default GlobalFiltersBar;
