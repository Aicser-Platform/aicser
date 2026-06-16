'use client';

import React, { useMemo } from 'react';
import { Input, Segmented, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { AssetType, FeedFilterOptions, FeedScope, FeedSort } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

export interface FeedFiltersValue {
  scope: FeedScope;
  assetType: 'all' | AssetType;
  sort: FeedSort;
  tags: string[];
  search?: string;
}

interface FeedFiltersProps {
  value: FeedFiltersValue;
  options: FeedFilterOptions;
  onChange: (value: FeedFiltersValue) => void;
}

type AssetOptionDef = {
  labelKey: 'filter_asset_all' | 'filter_asset_dashboard' | 'filter_asset_chart' | 'filter_asset_insight' | 'filter_asset_query';
  value: 'all' | AssetType;
  countKey?: AssetType;
};

const ASSET_OPTION_DEFS: AssetOptionDef[] = [
  { labelKey: 'filter_asset_all', value: 'all' },
  { labelKey: 'filter_asset_dashboard', value: 'dashboard', countKey: 'dashboard' },
  { labelKey: 'filter_asset_chart', value: 'chart', countKey: 'chart' },
  { labelKey: 'filter_asset_insight', value: 'insight', countKey: 'insight' },
  { labelKey: 'filter_asset_query', value: 'query', countKey: 'query' },
];

const FeedFilters: React.FC<FeedFiltersProps> = ({ value, options, onChange }) => {
  const t = useTranslations('feed_filters');

  const scopeOptions: { label: string; value: FeedScope }[] = isEnterpriseEdition
    ? [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_following'), value: 'following' },
        { label: t('scope_organization'), value: 'organization' },
        { label: t('scope_project'), value: 'project' },
      ]
    : [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_public'), value: 'public' },
      ];

  const update = (patch: Partial<FeedFiltersValue>) => {
    onChange({ ...value, ...patch });
  };

  const assetSelectOptions = useMemo(() => {
    const counts = options.assetCounts || { dashboard: 0, chart: 0, insight: 0, query: 0 };
    const allCount = counts.dashboard + counts.chart + counts.insight + (counts.query ?? 0);

    return ASSET_OPTION_DEFS.map((def) => {
      const count = def.countKey ? counts[def.countKey] : allCount;
      const isUnavailable = def.value !== 'all' && count === 0;
      return {
        label: t('filter_asset_with_count', { label: t(def.labelKey), count }),
        value: def.value,
        disabled: isUnavailable && value.assetType !== def.value,
      };
    });
  }, [options.assetCounts, value.assetType, t]);

  const quickTags = useMemo(() => (options.tags ?? []).slice(0, 8), [options.tags]);

  const toggleQuickTag = (tag: string) => {
    const next = value.tags.includes(tag) ? value.tags.filter((item) => item !== tag) : [...value.tags, tag];
    update({ tags: next });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Scope tabs */}
      <Segmented
        value={value.scope}
        options={scopeOptions}
        onChange={(next) => update({ scope: next as FeedScope })}
        aria-label={t('feed_scope_aria')}
      />

      {/* Filters row: selects on the left, search on the right — wraps cleanly on narrow widths */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={value.sort}
            onChange={(next) => update({ sort: next as FeedSort })}
            className="min-w-[140px]"
            options={[
              { label: t('sort_recommended'), value: 'recommended' },
              { label: t('sort_trending'), value: 'trending' },
              { label: t('sort_recent'), value: 'recent' },
            ]}
          />
          <Select
            value={value.assetType}
            onChange={(next) => update({ assetType: next as 'all' | AssetType })}
            options={assetSelectOptions}
            className="min-w-[160px]"
          />
          <Select
            mode="multiple"
            placeholder={t('filter_tags')}
            value={value.tags}
            onChange={(next) => update({ tags: next })}
            options={(options.tags ?? []).map((tag) => ({ label: tag, value: tag }))}
            className="min-w-[180px] flex-1 lg:flex-none lg:w-[260px]"
            maxTagCount={2}
          />
        </div>
        <Input
          allowClear
          placeholder={t('search_feed')}
          value={value.search || ''}
          onChange={(event) => update({ search: event.target.value })}
          prefix={<SearchOutlined />}
          className="w-full sm:w-64"
        />
      </div>

      {/* Quick tag chips */}
      {quickTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {quickTags.map((tag) => {
            const selected = value.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border ${
                  selected
                    ? 'bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] border-[var(--ant-color-primary-border)]'
                    : 'bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text-secondary)] border-[var(--ant-color-border)] hover:border-[var(--ant-color-primary-border)]'
                }`}
                onClick={() => toggleQuickTag(tag)}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FeedFilters;
