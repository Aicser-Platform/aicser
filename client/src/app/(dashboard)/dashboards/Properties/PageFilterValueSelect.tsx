'use client';

import React from 'react';
import { Select, Spin } from 'antd';
import { useFilterOptionsLoader } from '../hooks/useFilterOptionsLoader';
import type { RuntimeFilter } from '../utils/filterOperators';
import type { DashboardFilter } from '@/types/dashboard';

type FetchOptionsFn = (
  field: string,
  dataSourceId: string,
  ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
) => Promise<unknown>;

type Props = {
  filter: DashboardFilter;
  runtimeFilters: RuntimeFilter[];
  valueAsArray: string[];
  onChange: (vals: string[]) => void;
  fetchOptions?: FetchOptionsFn;
  /** Fallback when filter.config omits dataSourceId */
  fallbackDataSourceId?: string;
  fallbackTableName?: string;
};

/** Page/global filter control with distinct value loading (Power BI style). */
export function PageFilterValueSelect({
  filter,
  runtimeFilters,
  valueAsArray,
  onChange,
  fetchOptions,
  fallbackDataSourceId,
  fallbackTableName,
}: Props) {
  const dataSourceId = filter.dataSourceId || fallbackDataSourceId;
  const tableName = filter.tableName || fallbackTableName;
  const { options, loading } = useFilterOptionsLoader(
    filter.field,
    dataSourceId ? String(dataSourceId) : undefined,
    fetchOptions,
    runtimeFilters,
    {
      tableName: tableName ? String(tableName) : undefined,
      id: filter.id || filter.field,
      staticOptions: Array.isArray(filter.options)
        ? filter.options.map((o: string | { label?: string; value?: string }) =>
            typeof o === 'string'
              ? { label: o, value: o }
              : { label: String(o.label ?? o.value ?? ''), value: String(o.value ?? o.label ?? '') },
          )
        : undefined,
      enabled: Boolean(dataSourceId && fetchOptions),
    },
  );

  const useTags = options.length === 0 && !loading;

  return (
    <Select
      size="small"
      style={{ width: '100%' }}
      placeholder="All"
      value={valueAsArray.length > 0 ? valueAsArray : undefined}
      mode={useTags ? 'tags' : 'multiple'}
      allowClear
      loading={loading}
      showSearch
      optionFilterProp="label"
      onChange={onChange}
      options={options}
      notFoundContent={
        loading ? (
          <Spin size="small" />
        ) : (
          <span style={{ fontSize: 12 }}>
            {dataSourceId ? 'No values — type to add custom' : 'Configure a data source on this filter'}
          </span>
        )
      }
    />
  );
}

export default PageFilterValueSelect;
