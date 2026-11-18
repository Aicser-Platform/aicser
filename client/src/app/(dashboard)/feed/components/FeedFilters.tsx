'use client';

import React, { useMemo, useState } from 'react';
import { FolderKanban, ListFilter, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import { Input } from '@/components/aicser-ui/input';
import { Label } from '@/components/aicser-ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/aicser-ui/popover';
import { Segmented } from '@/components/aicser-ui/segmented';
import { cn } from '@/lib/ui/utils';
import type { AssetType, FeedFilterOptions, FeedScope, FeedSort } from '@/services/socialFeedService';

const isEnterpriseEdition = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

export interface FeedFiltersValue {
  scope: FeedScope;
  assetType: 'all' | AssetType;
  sort: FeedSort;
  tags: string[];
  search?: string;
  /** "Only Me" is cross-project by design (a personal scratch space) unlike every other scope, which follows the
   * active project; this narrows private posts to the current project. Ignored by every scope but 'private'. */
  privateProjectOnly?: boolean;
}

type StreamView = 'all' | 'insights' | 'discussions';

interface FeedFiltersProps {
  value: FeedFiltersValue;
  options: FeedFilterOptions;
  onChange: (value: FeedFiltersValue) => void;
  /** Optional stream focus: all | insights | discussions */
  streamView?: StreamView;
  onStreamViewChange?: (view: StreamView) => void;
}

type AssetOptionDef = {
  labelKey:
    | 'filter_asset_all'
    | 'filter_asset_post'
    | 'filter_asset_dashboard'
    | 'filter_asset_chart'
    | 'filter_asset_insight'
    | 'filter_asset_query';
  value: 'all' | AssetType;
  countKey?: AssetType;
};

const ASSET_OPTION_DEFS: AssetOptionDef[] = [
  { labelKey: 'filter_asset_all', value: 'all' },
  { labelKey: 'filter_asset_post', value: 'post', countKey: 'post' },
  { labelKey: 'filter_asset_dashboard', value: 'dashboard', countKey: 'dashboard' },
  { labelKey: 'filter_asset_chart', value: 'chart', countKey: 'chart' },
];

/** Feed toolbar in the desktop's style: whose posts · what kind · search · more filters (sort, type, tags). */
const FeedFilters: React.FC<FeedFiltersProps> = ({
  value,
  options,
  onChange,
  streamView = 'all',
  onStreamViewChange,
}) => {
  const t = useTranslations('feed_filters');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Narrowest → widest, the same order as the post composer's audience.
  const scopeOptions: { label: string; value: FeedScope }[] = isEnterpriseEdition
    ? [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_project'), value: 'project' },
        { label: t('scope_organization'), value: 'organization' },
        { label: t('scope_public'), value: 'public' },
      ]
    : [
        { label: t('scope_private'), value: 'private' },
        { label: t('scope_public'), value: 'public' },
      ];

  // "People I follow" is no longer offered: a persisted selection moves to the company feed, so the UI never
  // sits on an empty, unreachable scope.
  React.useEffect(() => {
    if (value.scope !== 'following') return;
    onChange({ ...value, scope: 'organization' });
    // Only a stale scope matters; the whole value would re-fire on every keystroke in search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.scope]);

  const update = (patch: Partial<FeedFiltersValue>) => onChange({ ...value, ...patch });

  const assetOptions = useMemo(() => {
    const counts = options.assetCounts || { dashboard: 0, chart: 0, insight: 0, query: 0, post: 0 };
    const allCount = counts.dashboard + counts.chart + counts.insight + (counts.query ?? 0) + (counts.post ?? 0);
    return ASSET_OPTION_DEFS.map((def) => {
      const count = def.countKey ? counts[def.countKey] : allCount;
      return {
        label: t('filter_asset_with_count', { label: t(def.labelKey), count: count ?? 0 }),
        value: def.value,
        disabled: def.value !== 'all' && count === 0 && value.assetType !== def.value,
      };
    });
  }, [options.assetCounts, value.assetType, t]);

  const tags = options.tags ?? [];
  const activeFilterCount =
    (value.sort !== 'recommended' ? 1 : 0) + (value.assetType !== 'all' ? 1 : 0) + (value.tags?.length ? 1 : 0);
  const toggleTag = (tag: string, on: boolean) =>
    update({ tags: on ? [...value.tags, tag] : value.tags.filter((existing) => existing !== tag) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label={t('feed_scope_aria')}
        value={value.scope}
        options={scopeOptions}
        onChange={(scope) => update({ scope })}
      />
      {value.scope === 'private' ? (
        <Button
          size="sm"
          variant={value.privateProjectOnly ? 'secondary' : 'outline'}
          aria-pressed={Boolean(value.privateProjectOnly)}
          title={t('scope_private_project_only_hint')}
          onClick={() => update({ privateProjectOnly: !value.privateProjectOnly })}
          className="rounded-full"
        >
          <FolderKanban />
          {t('scope_private_project_only')}
        </Button>
      ) : null}
      {onStreamViewChange ? (
        <Segmented
          label={t('stream_view_aria')}
          value={streamView}
          options={[
            { label: t('stream_all'), value: 'all' as const },
            { label: t('stream_insights'), value: 'insights' as const },
            { label: t('stream_discussions'), value: 'discussions' as const },
          ]}
          onChange={onStreamViewChange}
        />
      ) : null}

      <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('search_feed')}
            placeholder={t('search_feed')}
            value={value.search || ''}
            onChange={(event) => update({ search: event.target.value })}
            className={cn('pl-8', value.search ? 'pr-8' : undefined)}
          />
          {value.search ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('clear_filters')}
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => update({ search: '' })}
            >
              <X />
            </Button>
          ) : null}
        </div>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="shrink-0">
              <ListFilter />
              {t('more_filters')}
              {activeFilterCount > 0 ? (
                <Badge className="h-4 min-w-4 px-1 text-[10px]">{activeFilterCount}</Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="feed-sort" className="text-xs text-muted-foreground">
                {t('sort_label')}
              </Label>
              <NativeSelect
                id="feed-sort"
                className="w-full"
                value={value.sort}
                onChange={(event) => update({ sort: event.target.value as FeedSort })}
              >
                <NativeSelectOption value="recommended">{t('sort_recommended')}</NativeSelectOption>
                <NativeSelectOption value="trending">{t('sort_trending')}</NativeSelectOption>
                <NativeSelectOption value="recent">{t('sort_recent')}</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="feed-asset" className="text-xs text-muted-foreground">
                {t('asset_label')}
              </Label>
              <NativeSelect
                id="feed-asset"
                className="w-full"
                value={value.assetType}
                onChange={(event) => update({ assetType: event.target.value as 'all' | AssetType })}
              >
                {assetOptions.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1.5 p-0 text-xs font-medium text-muted-foreground">{t('tags_label')}</legend>
              {tags.length ? (
                <div className="grid max-h-40 gap-1 overflow-y-auto">
                  {tags.map((tag) => (
                    <label
                      key={tag}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={value.tags.includes(tag)}
                        onCheckedChange={(on) => toggleTag(tag, on === true)}
                      />
                      <span className="truncate">#{tag}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">{t('filter_tags')}</p>
              )}
            </fieldset>
            {activeFilterCount > 0 ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto self-start p-0"
                onClick={() => update({ sort: 'recommended', assetType: 'all', tags: [] })}
              >
                {t('clear_filters')}
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

export default FeedFilters;
