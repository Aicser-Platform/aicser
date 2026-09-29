'use client';

/**
 * Pick what an embed token shows by name — dashboards and saved charts, searchable — instead of
 * pasting an ID. Stores the ID; shows the name. An ID that isn't in the lists (another project,
 * or pasted) is still accepted and shown as is.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text } = Typography;

export type EmbedResource = { id: string; name: string; kind: 'dashboard' | 'chart'; detail?: string };

/** Dashboards and charts of the current project, loaded once; charts also searched on the server. */
export function useEmbedResources(query = '') {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [dashboards, setDashboards] = useState<EmbedResource[]>([]);
  const [charts, setCharts] = useState<EmbedResource[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('@/app/(dashboard)/dashboards/services/chartService')
      .then(({ chartService }) => chartService.listDashboards(projectId, { limit: 200 }))
      .then((list: Array<{ id: string; name?: string; title?: string }>) => {
        if (!cancelled) setDashboards(list.map((d) => ({ id: String(d.id), name: d.name || d.title || String(d.id), kind: 'dashboard' })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void import('@/app/(dashboard)/chart-designer/services/chartLibraryService')
        .then(({ chartLibraryService }) => chartLibraryService.list({ projectId, q: query || undefined, limit: 50 }))
        .then((res) => {
          if (!cancelled) setCharts(res.charts.map((c) => ({
            id: String(c.id), name: c.title || String(c.id), kind: 'chart', detail: c.chartType,
          })));
        })
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [projectId, query]);

  return { dashboards, charts, loading };
}

export function EmbedResourcePicker({ value, onChange, scopes }: {
  value?: string;
  onChange?: (v: string | undefined) => void;
  /** Which kinds to offer (the token's scopes). */
  scopes: string[];
}) {
  const t = useTranslations('settings');
  const [query, setQuery] = useState('');
  const { dashboards, charts, loading } = useEmbedResources(query);
  const lastLabel = useRef<Record<string, string>>({});

  const q = query.trim().toLowerCase();
  const match = (r: EmbedResource) => !q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
  const option = (r: EmbedResource) => {
    lastLabel.current[r.id] = r.name;
    return {
      value: r.id,
      label: r.name,
      title: r.name,
      render: (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{r.detail ?? r.id.slice(0, 8)}</Text>
        </span>
      ),
    };
  };

  const options = useMemo(() => {
    const groups = [];
    if (scopes.includes('dashboard')) {
      const d = dashboards.filter(match);
      if (d.length) groups.push({ label: t('embed_resource_dashboards'), title: 'dashboards', options: d.map(option) });
    }
    if (scopes.includes('chart')) {
      const c = charts.filter(match);
      if (c.length) groups.push({ label: t('embed_resource_charts'), title: 'charts', options: c.map(option) });
    }
    // A saved or pasted ID that isn't listed stays selectable, shown as is.
    const known = new Set([...dashboards, ...charts].map((r) => r.id));
    if (value && !known.has(value)) groups.push({ label: t('embed_resource_other'), title: 'other', options: [{ value, label: value, title: value, render: <span>{value}</span> }] });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboards, charts, scopes, q, value, t]);

  return (
    <Select
      showSearch
      allowClear
      value={value}
      onChange={(v) => onChange?.(v)}
      onSearch={setQuery}
      filterOption={false}
      loading={loading}
      placeholder={t('embed_resource_search')}
      notFoundContent={loading ? undefined : t('embed_resource_none')}
      options={options.map((g) => ({ ...g, options: g.options.map(({ render, ...o }) => ({ ...o, label: render, name: o.label })) }))}
      optionLabelProp="name"
      style={{ width: '100%' }}
    />
  );
}
