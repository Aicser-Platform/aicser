'use client';

import React, { useMemo, useState } from 'react';
import { Input, Select } from 'antd';
import { DownOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import type { AssetType, FeedFilterOptions, FeedScope, FeedSort } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';

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
  labelKey: 'filter_asset_all' | 'filter_asset_dashboard' | 'filter_asset_chart' | 'filter_asset_insight';
  value: 'all' | AssetType;
  countKey?: AssetType;
};

const ASSET_OPTION_DEFS: AssetOptionDef[] = [
  { labelKey: 'filter_asset_all', value: 'all' },
  { labelKey: 'filter_asset_dashboard', value: 'dashboard', countKey: 'dashboard' },
  { labelKey: 'filter_asset_chart', value: 'chart', countKey: 'chart' },
  { labelKey: 'filter_asset_insight', value: 'insight', countKey: 'insight' },
];

type FilterMenuKey = 'assetType' | 'tags';

const FeedFilters: React.FC<FeedFiltersProps> = ({ value, options, onChange }) => {
  const t = useTranslations('feed_filters');
  const scopeOptions: { label: string; value: FeedScope }[] = [
    { label: t('scope_private'), value: 'private' },
    { label: t('scope_following'), value: 'following' },
    { label: t('scope_organization'), value: 'organization' },
    { label: t('scope_project'), value: 'project' },
  ];
  const [openState, setOpenState] = useState<Record<FilterMenuKey, boolean>>({
    assetType: false,
    tags: false,
  });

  const update = (patch: Partial<FeedFiltersValue>) => {
    onChange({ ...value, ...patch });
  };

  const handleOpenChange = (key: FilterMenuKey) => (open: boolean) => {
    setOpenState((prev) => ({ ...prev, [key]: open }));
  };

  const renderArrow = (key: FilterMenuKey) =>
    openState[key] ? (
      <DownOutlined className="text-[10px] text-[var(--ant-color-text-description)] opacity-60 ml-2" />
    ) : (
      <UpOutlined className="text-[10px] text-[var(--ant-color-text-description)] opacity-60 ml-2" />
    );

  const assetSelectOptions = useMemo(() => {
    const counts = options.assetCounts || { dashboard: 0, chart: 0, insight: 0 };
    const allCount = counts.dashboard + counts.chart + counts.insight;

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
    <div className="flex flex-col gap-4 mb-6">
      <div
        className="flex flex-wrap gap-2 items-center bg-[var(--ant-color-bg-layout)] p-1 rounded-xl w-max"
        role="tablist"
        aria-label={t('feed_scope_aria')}
      >
        {scopeOptions.map((scope) => (
          <button
            key={scope.value}
            type="button"
            role="tab"
            aria-selected={value.scope === scope.value}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              value.scope === scope.value
                ? 'bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text)] shadow-sm border border-[var(--ant-color-border)]/50'
                : 'text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-border-secondary)]/50'
            }`}
            onClick={() => update({ scope: scope.value })}
          >
            {scope.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={value.assetType}
          onChange={(next) => update({ assetType: next as 'all' | AssetType })}
          options={assetSelectOptions}
          className="min-w-[160px]"
          suffixIcon={renderArrow('assetType')}
          onOpenChange={handleOpenChange('assetType')}
        />
        <Select
          mode="multiple"
          placeholder={t('filter_tags')}
          value={value.tags}
          onChange={(next) => update({ tags: next })}
          options={(options.tags ?? []).map((tag) => ({ label: tag, value: tag }))}
          className="min-w-[200px] flex-1 lg:flex-none lg:w-[300px]"
          maxTagCount={2}
          suffixIcon={renderArrow('tags')}
          onOpenChange={handleOpenChange('tags')}
        />
        <Input
          allowClear
          placeholder={t('search_feed')}
          value={value.search || ''}
          onChange={(event) => update({ search: event.target.value })}
          prefix={<SearchOutlined className="text-[var(--ant-color-text-description)]" />}
          className="flex-1 min-w-[200px] rounded-lg bg-[var(--ant-color-bg-layout)] border-[var(--ant-color-border)] hover:bg-[var(--ant-color-bg-container)] focus:bg-[var(--ant-color-bg-container)] transition-colors"
        />
      </div>

      {quickTags.length > 0 && (
        <div className="flex items-center gap-3 mt-1 pb-2 overflow-x-auto">
          <span className="text-sm font-semibold text-[var(--ant-color-text-description)] uppercase tracking-wider shrink-0">{t('tags_label')}</span>
          <div className="flex items-center gap-2">
            {quickTags.map((tag) => {
              const selected = value.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors whitespace-nowrap border ${
                    selected
                      ? 'bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] border-[var(--ant-color-primary)]'
                      : 'bg-[var(--ant-color-bg-container)] text-[var(--ant-color-text-secondary)] border-[var(--ant-color-border)] hover:bg-[var(--ant-color-bg-layout)]'
                  }`}
                  onClick={() => toggleQuickTag(tag)}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedFilters;
