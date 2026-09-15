import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_EXTENDED_CHART_TYPES,
  DASHBOARD_SWITCHABLE_CHART_TYPES,
  INTERACTIVE_CHART_TYPES,
  SAFE_CHART_TYPE_SWITCH_TARGETS,
  SHARED_CHART_TYPE_ORDER,
  dashboardChartTypeSwitchTargets,
  canClientPivotChartConfig,
  inferSeriesChartType,
  isForecastEchartsConfig,
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

  it('listAvailableChartTypes treats numeric strings as measures', () => {
    const types = listAvailableChartTypes([
      { category: 'A', value: '10' },
      { category: 'B', value: '20' },
    ]);
    expect(types).toContain('pie');
    expect(types).toContain('donut');
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

describe('forecast echarts configs', () => {
  const forecastCfg = {
    series: [
      { name: 'Historical', type: 'line', data: [1, 2, null] },
      { name: 'Forecast', type: 'line', data: [null, 2, 3] },
    ],
  };

  it('is not labeled Area just because a CI band used areaStyle', () => {
    const withBand = {
      series: [
        { name: 'Historical', type: 'line', data: [1, 2] },
        { name: 'Forecast', type: 'line', data: [null, 3] },
        { name: '95% Confidence', type: 'line', areaStyle: { opacity: 0.3 }, data: [null, 1] },
      ],
    };
    expect(isForecastEchartsConfig(withBand)).toBe(true);
    expect(inferSeriesChartType(withBand, null)).toBe('line');
  });

  it('keeps decorative hairline fill as Line (not Area)', () => {
    expect(
      inferSeriesChartType(
        { series: [{ type: 'line', data: [1, 2], areaStyle: { opacity: 0.1 } }] },
        null,
      ),
    ).toBe('line');
  });

  it('prefers stamped aiserChartType over series heuristics', () => {
    expect(
      inferSeriesChartType(
        {
          aiserChartType: 'line',
          series: [{ type: 'line', data: [1, 2], areaStyle: { opacity: 0.3 } }],
        },
        null,
      ),
    ).toBe('line');
  });

  it('labels real area fills as Area', () => {
    expect(
      inferSeriesChartType(
        { series: [{ type: 'line', data: [1, 2], areaStyle: { opacity: 0.3 } }] },
        null,
      ),
    ).toBe('area');
  });

  it('detects historical + forecast series', () => {
    expect(isForecastEchartsConfig(forecastCfg)).toBe(true);
    expect(inferSeriesChartType(forecastCfg, null)).toBe('line');
  });
});

describe('canClientPivotChartConfig', () => {
  it('allows normal bar/line options', () => {
    expect(canClientPivotChartConfig({ series: [{ type: 'bar', data: [1, 2] }] })).toBe(true);
  });

  it('locks forecast configs so CI bands are not flattened', () => {
    expect(
      canClientPivotChartConfig({
        series: [
          { name: 'Historical', type: 'line', data: [1, 2] },
          { name: 'Forecast', type: 'line', data: [null, 3] },
        ],
      }),
    ).toBe(false);
  });
});
