'use client';

import React, { useMemo } from 'react';
import { Input, Segmented, Select, Tag } from 'antd';
import { SearchOutlined, ProjectOutlined } from '@ant-design/icons';
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
  /** "Only Me" is cross-project by design (a personal scratch space) unlike
   * every other scope, which follows the active project selection — this is
   * the opt-in narrowing toggle for when a user wants their private posts
   * from just the current project. Ignored by every scope but 'private'. */
  privateProjectOnly?: boolean;
}

interface FeedFiltersProps {
  value: FeedFiltersValue;
  options: FeedFilterOptions;
  onChange: (value: FeedFiltersValue) => void;
}

type AssetOptionDef = {
  labelKey: 'filter_asset_all' | 'filter_asset_post' | 'filter_asset_dashboard' | 'filter_asset_chart' | 'filter_asset_insight' | 'filter_asset_query';
  value: 'all' | AssetType;
  countKey?: AssetType;
};

const ASSET_OPTION_DEFS: AssetOptionDef[] = [
  { labelKey: 'filter_asset_all', value: 'all' },
  { labelKey: 'filter_asset_post', value: 'post', countKey: 'post' },
  { labelKey: 'filter_asset_dashboard', value: 'dashboard', countKey: 'dashboard' },
  { labelKey: 'filter_asset_chart', value: 'chart', countKey: 'chart' },
  // { labelKey: 'filter_asset_insight', value: 'insight', countKey: 'insight' },
  // { labelKey: 'filter_asset_query', value: 'query', countKey: 'query' },
];

const FeedFilters: React.FC<FeedFiltersProps> = ({ value, options, onChange }) => {
  const t = useTranslations('feed_filters');

  const scopeOptions: { label: string; value: FeedScope }[] = isEnterpriseEdition
    ? [
      { label: t('scope_private'), value: 'private' },
      { label: t('scope_following'), value: 'following' },
      { label: t('scope_organization'), value: 'organization' },
      { label: t('scope_project'), value: 'project' },
      { label: t('scope_public'), value: 'public' },
    ]
    : [
      { label: t('scope_private'), value: 'private' },
      { label: t('scope_public'), value: 'public' },
    ];

  const update = (patch: Partial<FeedFiltersValue>) => {
    onChange({ ...value, ...patch });
  };

  const assetSelectOptions = useMemo(() => {
    const counts = options.assetCounts || { dashboard: 0, chart: 0, insight: 0, query: 0, post: 0 };
    const allCount = counts.dashboard + counts.chart + counts.insight + (counts.query ?? 0) + (counts.post ?? 0);

    return ASSET_OPTION_DEFS.map((def) => {
      const count = def.countKey ? counts[def.countKey] : allCount;
      const isUnavailable = def.value !== 'all' && count === 0;
      return {
        label: t('filter_asset_with_count', { label: t(def.labelKey), count: count ?? 0 }),
        value: def.value,
        disabled: isUnavailable && value.assetType !== def.value,
      };
    });
  }, [options.assetCounts, value.assetType, t]);

  // Tag filtering used to also have a second, differently-styled row of quick-
  // pick chips below this bar — a redundant second control for the exact same
  // `value.tags` state as the Select just below, styled as loose pills instead
  // of a dropdown. Dropped in favor of one consistent control (this Select,
  // styled identically to the "All assets" Select) and one line overall.
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Segmented
        value={value.scope}
        options={scopeOptions}
        onChange={(next) => update({ scope: next as FeedScope })}
        aria-label={t('feed_scope_aria')}
        className="!rounded-lg p-0.5 bg-[var(--ant-color-bg-layout)] border border-[var(--ant-color-border-secondary)]"
      />
      {value.scope === 'private' && (
        <Tag
          icon={<ProjectOutlined />}
          color={value.privateProjectOnly ? 'blue' : 'default'}
          className="cursor-pointer select-none rounded-full px-2.5 py-0.5 text-xs font-medium m-0 border border-[var(--ant-color-border)]"
          onClick={() => update({ privateProjectOnly: !value.privateProjectOnly })}
          title={t('scope_private_project_only_hint')}
        >
          {t('scope_private_project_only')}
        </Tag>
      )}
      <Select
        value={value.sort}
        onChange={(next) => update({ sort: next as FeedSort })}
        className="min-w-[140px] [&_.ant-select-selector]:!rounded-lg"
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
        className="min-w-[160px] [&_.ant-select-selector]:!rounded-lg"
      />
      <Select
        mode="multiple"
        placeholder={t('filter_tags')}
        value={value.tags}
        onChange={(next) => update({ tags: next })}
        options={(options.tags ?? []).map((tag) => ({ label: tag, value: tag }))}
        // Tag chips get their own tinted pill (bg + matching-tint border)
        // instead of antd's default gray-on-gray chip, which read as a
        // "double border" sitting this close to the selector's own edge.
        className="min-w-[160px] [&_.ant-select-selector]:!rounded-lg [&_.ant-select-selection-item]:!border-[var(--ant-color-primary-border)] [&_.ant-select-selection-item]:!bg-[var(--ant-color-primary-bg)]"
        maxTagCount="responsive"
      />
      <Input
        allowClear
        placeholder={t('search_feed')}
        value={value.search || ''}
        onChange={(event) => update({ search: event.target.value })}
        prefix={<SearchOutlined className="text-gray-400" />}
        className="ml-auto w-full sm:w-64 rounded-lg"
      />
    </div>
  );
};

export default FeedFilters;
