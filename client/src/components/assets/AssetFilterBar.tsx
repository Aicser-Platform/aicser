'use client';

import React from 'react';
import { Input, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

export type AssetScope = 'all' | 'mine' | 'shared';

type Filterable = { title: string; description?: string | null; is_owner?: boolean };

/** Items matching the search (title or description) and the owner filter. */
export function filterAssets<T extends Filterable>(items: T[], query: string, scope: AssetScope): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((it) => {
    if (scope === 'mine' && !it.is_owner) return false;
    if (scope === 'shared' && it.is_owner) return false;
    return !q || it.title.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q);
  });
}

/**
 * Search plus "All / Mine / Shared with me" for a library of project assets (notebooks, sheets),
 * the way Hex and Mode list work in a project.
 */
export function AssetFilterBar({
  query, onQuery, scope, onScope, placeholder, leading,
}: {
  query: string;
  onQuery: (q: string) => void;
  scope: AssetScope;
  onScope: (s: AssetScope) => void;
  placeholder: string;
  /** Shown first, e.g. the folder filter. */
  leading?: React.ReactNode;
}) {
  const t = useTranslations('asset_filter');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
      {leading}
      <Input
        allowClear
        prefix={<SearchOutlined />}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ maxWidth: 360, flex: '1 1 240px' }}
      />
      <Segmented<AssetScope>
        value={scope}
        onChange={onScope}
        options={[
          { value: 'all', label: t('all') },
          { value: 'mine', label: t('mine') },
          { value: 'shared', label: t('shared') },
        ]}
      />
    </div>
  );
}
