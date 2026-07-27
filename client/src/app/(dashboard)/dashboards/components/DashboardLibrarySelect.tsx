'use client';

/**
 * Shared dashboard picker — server search + infinite scroll.
 * Used by Chat pin, Query Visualize, Chart Designer pin (SSOT).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Select, Segmented, Spin } from 'antd';
import {
  dashboardLibraryService,
  type DashboardLibraryFacet,
  type DashboardLibraryItem,
} from '../services/dashboardLibraryService';
import { useProjectStore } from '@/stores/useProjectStore';

export type DashboardPickerOption = {
  id: string;
  label: string;
  isFavorite?: boolean;
  chartCount?: number;
};

type Props = {
  value?: string | null;
  onChange: (id: string | null) => void;
  /** Extra option appended (e.g. create-new) */
  extraOptions?: Array<{ value: string; label: string }>;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** Prefer recent / favorites for pin targets */
  defaultFacet?: DashboardLibraryFacet;
};

export function DashboardLibrarySelect({
  value,
  onChange,
  extraOptions = [],
  placeholder = 'Select dashboard',
  allowClear,
  style,
  disabled,
  defaultFacet = 'recent',
}: Props) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [facet, setFacet] = useState<DashboardLibraryFacet>(defaultFacet);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<DashboardLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (opts: { reset?: boolean; nextOffset?: number; search?: string; nextFacet?: DashboardLibraryFacet } = {}) => {
      setLoading(true);
      try {
        const nextOff = opts.reset ? 0 : (opts.nextOffset ?? 0);
        const result = await dashboardLibraryService.list({
          projectId: currentProjectId,
          q: opts.search ?? q,
          facet: opts.nextFacet ?? facet,
          limit: 40,
          offset: nextOff,
          detail: 'summary',
        });
        setItems((prev) => (opts.reset || nextOff === 0 ? result.dashboards : [...prev, ...result.dashboards]));
        setOffset(result.offset + result.dashboards.length);
        setHasMore(result.hasMore);
        // Auto-select first when empty
        if ((opts.reset || nextOff === 0) && !value && result.dashboards[0]?.id) {
          onChange(String(result.dashboards[0].id));
        }
      } catch (err) {
        console.error('[DashboardLibrarySelect]', err);
        if (opts.reset) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [currentProjectId, facet, q, value, onChange],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load({ reset: true, search: q });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, facet, q]);

  const options = useMemo(() => {
    const mapped = items.map((d) => ({
      value: String(d.id),
      label: `${d.title || d.name || d.id}${d.isFavorite ? ' ★' : ''}${
        typeof d.chartCount === 'number' ? ` · ${d.chartCount}` : ''
      }`,
    }));
    return [...mapped, ...extraOptions];
  }, [items, extraOptions]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <Segmented
        size="small"
        value={facet}
        onChange={(v) => setFacet(v as DashboardLibraryFacet)}
        options={[
          { label: 'Recent', value: 'recent' },
          { label: '★', value: 'favorites' },
          { label: 'All', value: 'all' },
        ]}
        block
      />
      <Select
        showSearch
        filterOption={false}
        onSearch={setQ}
        loading={loading}
        disabled={disabled}
        allowClear={allowClear}
        placeholder={placeholder}
        style={{ width: '100%', ...style }}
        value={value ?? undefined}
        onChange={(id) => onChange(id ?? null)}
        options={options}
        notFoundContent={loading ? <Spin size="small" /> : 'No dashboards'}
        popupRender={(menu) => (
          <>
            {menu}
            {hasMore ? (
              <div
                style={{ padding: 8, textAlign: 'center', cursor: 'pointer' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void load({ nextOffset: offset })}
              >
                {loading ? 'Loading…' : 'Load more'}
              </div>
            ) : null}
          </>
        )}
      />
    </div>
  );
}

export default DashboardLibrarySelect;
