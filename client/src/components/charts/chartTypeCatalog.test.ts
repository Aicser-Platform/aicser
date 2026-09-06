import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_EXTENDED_CHART_TYPES,
  DASHBOARD_SWITCHABLE_CHART_TYPES,
  INTERACTIVE_CHART_TYPES,
  SAFE_CHART_TYPE_SWITCH_TARGETS,
  SHARED_CHART_TYPE_ORDER,
  dashboardChartTypeSwitchTargets,
  isSafeChartTypeSwitchTarget,
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

describe('SAFE_CHART_TYPE_SWITCH_TARGETS', () => {
  it('is exactly the core 8 — every extended type lacks a real buildFromQueryResult transform', () => {
    // Regression guard: the "Change chart type" menus (chat preview, Studio, Explain
    // drawer) must never offer a switch that echartsToSharedWidget.ts's
    // buildFromQueryResult can't actually build correct data for. If someone adds a
    // type to SAFE_CHART_TYPE_SWITCH_TARGETS without giving it a dedicated builder,
    // this is the tripwire that should force them to reconsider.
    expect([...SAFE_CHART_TYPE_SWITCH_TARGETS]).toEqual([...SHARED_CHART_TYPE_ORDER]);
    for (const ext of DASHBOARD_EXTENDED_CHART_TYPES) {
      expect(SAFE_CHART_TYPE_SWITCH_TARGETS).not.toContain(ext);
    }
  });

  it('isSafeChartTypeSwitchTarget accepts only the core 8, case-sensitively lowercase', () => {
    for (const t of SHARED_CHART_TYPE_ORDER) {
      expect(isSafeChartTypeSwitchTarget(t)).toBe(true);
    }
    for (const ext of DASHBOARD_EXTENDED_CHART_TYPES) {
      expect(isSafeChartTypeSwitchTarget(ext)).toBe(false);
    }
    expect(isSafeChartTypeSwitchTarget('not-a-real-type')).toBe(false);
  });
});

describe('dashboardChartTypeSwitchTargets', () => {
  it('offers only the safe core 8 when the widget is already a safe (core) type', () => {
    // A widget that's already "bar" shouldn't have "heatmap" or "geo" dangled as an
    // option — those would silently corrupt its data via the generic x/y fallback.
    const targets = dashboardChartTypeSwitchTargets('bar');
    expect(targets).toEqual([...SAFE_CHART_TYPE_SWITCH_TARGETS]);
    for (const ext of DASHBOARD_EXTENDED_CHART_TYPES) {
      expect(targets).not.toContain(ext);
    }
  });

  it('keeps an extended current type in its own list so it does not appear to vanish', () => {
    // Regression: a widget the AI created directly as a Geo map is still a valid,
    // correctly-rendering widget — hiding it from its own switcher entirely would
    // read as "my chart type disappeared" even though nothing broke.
    const targets = dashboardChartTypeSwitchTargets('geo');
    expect(targets).toContain('geo');
    expect(targets.filter((t) => t === 'geo')).toHaveLength(1);
  });

  it('never offers a second, different extended type alongside the current extended type', () => {
    const targets = dashboardChartTypeSwitchTargets('geo');
    for (const ext of DASHBOARD_EXTENDED_CHART_TYPES) {
      if (ext === 'geo') continue;
      expect(targets).not.toContain(ext);
    }
  });

  it('defaults to the safe core 8 for an empty/undefined current type', () => {
    expect(dashboardChartTypeSwitchTargets(undefined)).toEqual([...SAFE_CHART_TYPE_SWITCH_TARGETS]);
    expect(dashboardChartTypeSwitchTargets('')).toEqual([...SAFE_CHART_TYPE_SWITCH_TARGETS]);
  });

  it('is case-insensitive on the current type', () => {
    const targets = dashboardChartTypeSwitchTargets('GEO');
    expect(targets).toContain('geo');
    expect(targets).not.toContain('GEO');
  });
});
