'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeFilterOptions, type RuntimeFilter, unwrapFilterOptionsResponse } from '../utils/filterOperators';

type FetchOptionsFn = (
  field: string,
  dataSourceId: string,
  ctx?: { tableName?: string; runtimeFilters?: RuntimeFilter[]; excludeField?: string },
) => Promise<unknown>;

export function filterOptionsKey(
  field: string,
  dataSourceId: string,
  tableName?: string,
  id?: string,
): string {
  return `${id || field}:${field}:${dataSourceId}:${tableName || ''}`;
}

/** Load distinct filter option lists with cascade support. */
export function useFilterOptionsLoader(
  field: string,
  dataSourceId: string | undefined,
  fetchOptions: FetchOptionsFn | undefined,
  runtimeFilters: RuntimeFilter[],
  opts?: {
    tableName?: string;
    id?: string;
    staticOptions?: Array<{ label: string; value: string }>;
    enabled?: boolean;
  },
) {
  const enabled = opts?.enabled !== false;
  const key = dataSourceId ? filterOptionsKey(field, dataSourceId, opts?.tableName, opts?.id) : '';
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>(
    normalizeFilterOptions(opts?.staticOptions || []),
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !fetchOptions || !field || !dataSourceId) return;
    setLoading(true);
    try {
      const values = normalizeFilterOptions(
        unwrapFilterOptionsResponse(
          await fetchOptions(field, dataSourceId, {
            tableName: opts?.tableName,
            runtimeFilters,
            excludeField: field,
          }),
        ),
      );
      const fallback = normalizeFilterOptions(opts?.staticOptions || []);
      setOptions(values.length ? values : fallback);
    } catch {
      setOptions(normalizeFilterOptions(opts?.staticOptions || []));
    } finally {
      setLoading(false);
    }
  }, [enabled, fetchOptions, field, dataSourceId, opts?.tableName, opts?.staticOptions, runtimeFilters]);

  useEffect(() => {
    void load();
  }, [load]);

  return { options, loading, key, reload: load };
}
