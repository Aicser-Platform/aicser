'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tooltip, Divider } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
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
  onChange: (filters: RuntimeFilter[]) => void;
  searchDraft: string;
  onSearchDraft: (field: string, value: string) => void;
};

function ReportFilterRow({
  filter,
  runtimeFilters,
  layout,
  fetchOptions,
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

  const removeField = (field: string) => runtimeFilters.filter((f) => f.field !== field);

  if (filter.type === 'dateRange') {
    return (
      <FilterDateRangeField
        label={label}
        field={filter.field}
        runtimeFilters={runtimeFilters}
        presets={datePresets}
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
        placeholder={t('filter_select_value')}
        options={options}
        loading={loading}
        emptyLabel={t('filter_options_empty')}
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
        placeholder={t('filter_select_value')}
        options={options}
        loading={loading}
        emptyLabel={t('filter_options_empty')}
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
  layout?: FilterBarLayout;
  minimal?: boolean;
  onClearAll?: () => void;
};

export function GlobalFiltersBar({
  filters,
  runtimeFilters,
  onChange,
  fetchOptions,
  layout = 'panel',
  minimal = false,
  onClearAll,
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

  const rows = filters.map((filter) => (
    <ReportFilterRow
      key={filter.id || filter.field}
      filter={filter}
      runtimeFilters={runtimeFilters}
      layout={layout}
      fetchOptions={fetchOptions}
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
      <div className="report-filter-toolbar-track">
        {filters.map((filter, index) => (
          <React.Fragment key={filter.id || filter.field}>
            {index > 0 && <Divider type="vertical" className="report-filter-vdivider" />}
            <div className="report-filter-toolbar-item">{rows[index]}</div>
          </React.Fragment>
        ))}
        {clearControl && (
          <>
            <Divider type="vertical" className="report-filter-vdivider" />
            <div className="report-filter-toolbar-actions">{clearControl}</div>
          </>
        )}
      </div>
    </div>
  );
}

export default GlobalFiltersBar;
