import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@/services/socialFeedService';
import {
  feedItemHasLiveVisual,
  resolveFeedCardHeading,
  resolveFeedPostSummary,
  showFeedAssetTypeBadge,
  visibleFeedTags,
} from './feedPostDisplay';

describe('visibleFeedTags', () => {
  it('drops generic Analytics/type labels on chart and dashboard posts', () => {
    expect(visibleFeedTags(['Analytics', 'revenue'], 'dashboard')).toEqual(['revenue']);
    expect(visibleFeedTags(['chart', 'Dashboard'], 'chart')).toEqual([]);
    expect(visibleFeedTags(['insights'], 'insight')).toEqual([]);
  });

  it('keeps tags on text posts', () => {
    expect(visibleFeedTags(['Analytics', 'q4'], 'post')).toEqual(['Analytics', 'q4']);
  });
});

describe('showFeedAssetTypeBadge', () => {
  it('hides the type pill on visual assets', () => {
    expect(showFeedAssetTypeBadge('chart')).toBe(false);
    expect(showFeedAssetTypeBadge('dashboard')).toBe(false);
    expect(showFeedAssetTypeBadge('insight')).toBe(false);
    expect(showFeedAssetTypeBadge('post')).toBe(true);
  });
});

describe('feedItemHasLiveVisual', () => {
  const base = {
    assetType: 'chart' as const,
    asset: { summary: '', previewLabel: '' },
  };

  it('detects snapshot and chart widgets', () => {
    expect(
      feedItemHasLiveVisual({
        ...base,
        asset: { ...base.asset, snapshotPayload: { visuals: { widgets: [] } } },
      } as FeedItem),
    ).toBe(true);
    expect(
      feedItemHasLiveVisual({
        ...base,
        asset: { ...base.asset, chartWidget: { chartType: 'bar' } },
      } as FeedItem),
    ).toBe(true);
  });

  it('is false when only a still thumbnail could exist', () => {
    expect(feedItemHasLiveVisual(base as FeedItem)).toBe(false);
  });
});

describe('resolveFeedCardHeading', () => {
  const chartAsset = {
    summary: '',
    previewLabel: 'Analytics',
    chartWidget: {
      chartType: 'pie',
      chartOptions: { title: 'Principal Amount Share by Npl Flag' },
    },
  };

  it('hides Analytics when the live chart already has a title', () => {
    expect(
      resolveFeedCardHeading({
        title: 'Analytics',
        assetType: 'insight',
        asset: chartAsset,
      } as FeedItem),
    ).toBe('');
  });

  it('hides a heading that duplicates the in-chart title', () => {
    expect(
      resolveFeedCardHeading({
        title: 'Principal Amount Share by Npl Flag',
        assetType: 'chart',
        asset: chartAsset,
      } as FeedItem),
    ).toBe('');
  });

  it('keeps a real caption that is not the chart title', () => {
    expect(
      resolveFeedCardHeading({
        title: 'Q4 collateral mix',
        assetType: 'insight',
        asset: chartAsset,
      } as FeedItem),
    ).toBe('Q4 collateral mix');
  });
});

describe('resolveFeedPostSummary', () => {
  const dashboard = {
    title: 'New dash',
    assetType: 'dashboard' as const,
    asset: { summary: '', previewLabel: '' },
  };

  it('hides placeholder descriptions on visual cards', () => {
    expect(
      resolveFeedPostSummary({ ...dashboard, description: 'df' } as FeedItem),
    ).toBe('');
  });

  it('keeps a real dashboard caption', () => {
    expect(
      resolveFeedPostSummary({
        ...dashboard,
        description: 'Q4 loan book across branches',
      } as FeedItem),
    ).toBe('Q4 loan book across branches');
  });

  it('prefers fuller excerpt when description is a 320-char clip', () => {
    const long =
      'Tracking academic performance trends and segment drivers across cohorts. '.repeat(8).trim();
    const clipped = `${long.slice(0, 320).trimEnd()}…`;
    expect(
      resolveFeedPostSummary({
        ...dashboard,
        description: clipped,
        asset: { ...dashboard.asset, excerpt: long },
      } as FeedItem),
    ).toBe(long);
  });
});
