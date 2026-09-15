import { describe, expect, it } from 'vitest';
import {
  feedDashboardPreviewRecipe,
  feedPreviewKind,
  feedPreviewMoreBadge,
  orderFeedPreviewWidgets,
  pickFeedPreviewWidgets,
} from '../feedDashboardPreviewLayout';

describe('feedPreviewKind', () => {
  it('classifies text, kpi, and chart widgets', () => {
    expect(feedPreviewKind('text')).toBe('text');
    expect(feedPreviewKind('stat')).toBe('kpi');
    expect(feedPreviewKind('gauge')).toBe('kpi');
    expect(feedPreviewKind('bar')).toBe('chart');
    expect(feedPreviewKind('line')).toBe('chart');
  });
});

describe('pickFeedPreviewWidgets', () => {
  it('drops text widgets when a KPI or chart is available', () => {
    const picked = pickFeedPreviewWidgets(
      [
        { id: 't', chartType: 'text' },
        { id: 's', chartType: 'stat' },
        { id: 'c', chartType: 'bar' },
      ],
      2,
    );
    expect(picked.map((w) => w.id)).toEqual(['s', 'c']);
  });

  it('prefers a chart as the single grid-card hero', () => {
    const picked = pickFeedPreviewWidgets(
      [
        { id: 's', chartType: 'stat' },
        { id: 'c', chartType: 'bar' },
      ],
      1,
    );
    expect(picked.map((w) => w.id)).toEqual(['c']);
  });

  it('keeps text when the dashboard has no visual widgets', () => {
    const picked = pickFeedPreviewWidgets([{ id: 't', chartType: 'text' }], 1);
    expect(picked.map((w) => w.id)).toEqual(['t']);
  });
});

describe('orderFeedPreviewWidgets', () => {
  it('promotes a single chart to the hero slot when there are three tiles', () => {
    const ordered = orderFeedPreviewWidgets([
      { id: 't', chartType: 'text' },
      { id: 's', chartType: 'stat' },
      { id: 'c', chartType: 'line' },
    ]);
    expect(ordered.map((w) => w.id)).toEqual(['c', 't', 's']);
  });
});

describe('feedDashboardPreviewRecipe', () => {
  it('uses a full-width 16:9 frame for a single chart', () => {
    const recipe = feedDashboardPreviewRecipe(['chart']);
    expect(recipe.chartOnly).toBe(true);
    expect(recipe.gridClass).toBe('grid-cols-1');
  });

  it('uses a two-column equal row for text + kpi when the card is wide', () => {
    const recipe = feedDashboardPreviewRecipe(['text', 'kpi']);
    expect(recipe.chartOnly).toBe(false);
    expect(recipe.gridClass).toBe('grid-cols-2');
    expect(recipe.heights).toEqual([220, 220]);
  });

  it('spans a hero chart across the first row when there are three tiles', () => {
    const recipe = feedDashboardPreviewRecipe(['chart', 'kpi', 'kpi']);
    expect(recipe.spans[0]).toBe('col-span-2');
    expect(recipe.heights[0]).toBe(220);
  });

  it('lays four tiles out as a 2×2 grid', () => {
    const recipe = feedDashboardPreviewRecipe(['kpi', 'kpi', 'chart', 'chart']);
    expect(recipe.gridClass).toBe('grid-cols-2');
    expect(recipe.spans.every((s) => s === '')).toBe(true);
    expect(recipe.heights).toEqual([128, 128, 180, 180]);
  });
});

describe('feedPreviewMoreBadge', () => {
  it('returns a compact +N mark and nothing when the tease is complete', () => {
    expect(feedPreviewMoreBadge(4)).toBe('+4');
    expect(feedPreviewMoreBadge(1)).toBe('+1');
    expect(feedPreviewMoreBadge(0)).toBeNull();
    expect(feedPreviewMoreBadge(-1)).toBeNull();
  });
});
