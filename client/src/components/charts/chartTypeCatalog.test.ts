import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_EXTENDED_CHART_TYPES,
  DASHBOARD_SWITCHABLE_CHART_TYPES,
  INTERACTIVE_CHART_TYPES,
  SHARED_CHART_TYPE_ORDER,
  listAvailableChartTypes,
  listDashboardVisualizeChartTypes,
} from './chartTypeCatalog';

describe('chartTypeCatalog alignment', () => {
  it('keeps chat interactive types as a prefix of the shared core order', () => {
    const coreInteractive = INTERACTIVE_CHART_TYPES.filter(
      (t) => t !== 'bar_race' && t !== 'line_race',
    );
    expect([...SHARED_CHART_TYPE_ORDER]).toEqual([...coreInteractive]);
  });

  it('starts dashboard Build switcher with the same order as chat pivot core', () => {
    expect(DASHBOARD_SWITCHABLE_CHART_TYPES.slice(0, SHARED_CHART_TYPE_ORDER.length)).toEqual([
      ...SHARED_CHART_TYPE_ORDER,
    ]);
  });

  it('listAvailableChartTypes follows bar → line → area first (chat pivot)', () => {
    const types = listAvailableChartTypes([
      { category: 'A', value: 1 },
      { category: 'B', value: 2 },
    ]);
    expect(types.slice(0, 3)).toEqual(['bar', 'line', 'area']);
    expect(types).toContain('pie');
    expect(types).toContain('donut');
    expect(types).toContain('table');
  });

  it('listDashboardVisualizeChartTypes appends dashboard extensions after chat core', () => {
    const types = listDashboardVisualizeChartTypes([{ category: 'A', value: 1 }]);
    expect(types.slice(0, 3)).toEqual(['bar', 'line', 'area']);
    for (const ext of DASHBOARD_EXTENDED_CHART_TYPES) {
      expect(types).toContain(ext);
    }
  });
});
