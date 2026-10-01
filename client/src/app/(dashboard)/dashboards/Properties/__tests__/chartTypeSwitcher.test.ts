import { describe, expect, it } from 'vitest';
import { buildDashboardChartTypeSwitcherOptions } from '../dashboardChartTypeSwitcher';

const enabled = (type: string, q: any) =>
  buildDashboardChartTypeSwitcherOptions(type, q).filter((o) => !('disabled' in o && o.disabled)).map((o) => o.type);

describe('chart type switcher', () => {
  const bar = { x: 'province', yMetrics: [{ field: 'sales', aggregation: 'sum' }] };

  it('offers map, funnel, treemap and waterfall whenever there is a category and a number', () => {
    const types = enabled('bar', bar);
    for (const t of ['geo', 'funnel', 'treemap', 'waterfall', 'gauge']) expect(types).toContain(t);
    expect(types).not.toContain('heatmap');
  });

  it('keeps Map reachable after switching away from it, so the map can come back', () => {
    expect(enabled('pie', bar)).toContain('geo');
    expect(enabled('stat', bar)).toContain('geo');
  });

  it('offers a heatmap once there is a second category', () => {
    expect(enabled('bar', { ...bar, groupField: 'region' })).toContain('heatmap');
  });

  it('offers nothing extended without fields', () => {
    expect(enabled('bar', {})).not.toContain('geo');
  });
});
