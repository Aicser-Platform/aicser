'use client';

import React, { useMemo, useState } from 'react';
import { Badge, Button, Input, Popover, Segmented, Select, Tag } from 'antd';
import { FilterOutlined, SearchOutlined, ProjectOutlined } from '@ant-design/icons';
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
  /** Optional stream focus: all | insights | discussions */
  streamView?: 'all' | 'insights' | 'discussions';
  onStreamViewChange?: (view: 'all' | 'insights' | 'discussions') => void;
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
];

const FeedFilters: React.FC<FeedFiltersProps> = ({
  value,
  options,
  onChange,
  streamView = 'all',
  onStreamViewChange,
}) => {
  const t = useTranslations('feed_filters');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const scopeOptions: { label: string; value: FeedScope }[] = isEnterpriseEdition
    ? [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_organization'), value: 'organization' },
        { label: t('scope_project'), value: 'project' },
        { label: t('scope_public'), value: 'public' },
      ]
    : [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_public'), value: 'public' },
      ];

  // Legacy "People I follow" is no longer offered — migrate any persisted
  // selection to the company feed so the filter store can't leave the UI on
  // an empty, unreachable scope.
  React.useEffect(() => {
    if (value.scope !== 'following') return;
    onChange({ ...value, scope: 'organization' });
    // Only react to a stale scope value; including full `value`/`onChange`
    // would re-fire on every keystroke in search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.scope]);

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

  const activeFilterCount =
    (value.sort !== 'recommended' ? 1 : 0) +
    (value.assetType !== 'all' ? 1 : 0) +
    (value.tags?.length ? 1 : 0);

  const moreFilters = (
    <div className="flex w-[280px] flex-col gap-3 p-1">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--ant-color-text-secondary)]">{t('sort_label')}</span>
        <Select
          value={value.sort}
          onChange={(next) => update({ sort: next as FeedSort })}
          className="w-full"
          options={[
            { label: t('sort_recommended'), value: 'recommended' },
            { label: t('sort_trending'), value: 'trending' },
            { label: t('sort_recent'), value: 'recent' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--ant-color-text-secondary)]">{t('asset_label')}</span>
        <Select
          value={value.assetType}
          onChange={(next) => update({ assetType: next as 'all' | AssetType })}
          options={assetSelectOptions}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--ant-color-text-secondary)]">{t('tags_label')}</span>
        <Select
          mode="multiple"
          placeholder={t('filter_tags')}
          value={value.tags}
          onChange={(next) => update({ tags: next })}
          options={(options.tags ?? []).map((tag) => ({ label: tag, value: tag }))}
          className="w-full"
          maxTagCount="responsive"
        />
      </div>
      {activeFilterCount > 0 && (
        <Button
          type="link"
          size="small"
          className="self-start px-0"
          onClick={() => update({ sort: 'recommended', assetType: 'all', tags: [] })}
        >
          {t('clear_filters')}
        </Button>
      )}
    </div>
  );

  return (
    <div className="page-panel-toolbar">
      <div className="page-panel-toolbar__row">
        <div className="page-panel-toolbar__filters">
          <Segmented
            value={value.scope}
            options={scopeOptions}
            onChange={(next) => update({ scope: next as FeedScope })}
            aria-label={t('feed_scope_aria')}
            size="small"
          />
          {value.scope === 'private' && (
            <Tag
              icon={<ProjectOutlined />}
              color={value.privateProjectOnly ? 'blue' : 'default'}
              className="m-0 cursor-pointer select-none rounded-full px-2.5 py-0.5 text-xs font-medium"
              onClick={() => update({ privateProjectOnly: !value.privateProjectOnly })}
              title={t('scope_private_project_only_hint')}
            >
              {t('scope_private_project_only')}
            </Tag>
          )}
        </div>
      </div>

      <div className="page-panel-toolbar__row">
        <div className="page-panel-toolbar__filters">
          {onStreamViewChange ? (
            <Segmented
              size="small"
              value={streamView}
              onChange={(next) => onStreamViewChange(next as 'all' | 'insights' | 'discussions')}
              options={[
                { label: t('stream_all'), value: 'all' },
                { label: t('stream_insights'), value: 'insights' },
                { label: t('stream_discussions'), value: 'discussions' },
              ]}
              aria-label={t('stream_view_aria')}
            />
          ) : null}
        </div>
        <Input
          allowClear
          placeholder={t('search_feed')}
          value={value.search || ''}
          onChange={(event) => update({ search: event.target.value })}
          prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
          className="page-panel-toolbar__search"
        />
        <div className="page-panel-toolbar__actions">
          <Popover
            trigger="click"
            placement="bottomRight"
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            content={moreFilters}
          >
            <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
              <Button icon={<FilterOutlined />}>{t('more_filters')}</Button>
            </Badge>
          </Popover>
        </div>
      </div>
    </div>
  );
};

export default FeedFilters;
