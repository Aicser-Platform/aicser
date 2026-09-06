import { describe, expect, it } from 'vitest';
import {
  applyPresetWithScaffolds,
  isLayoutSlotWidget,
  rankWidgetForSlot,
  suggestLayoutPreset,
} from './layoutScaffolds';
import type { LayoutPreset } from '../components/LayoutPresetsMenu';
import type { LayoutItem } from '../stores/useDashboardStore';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

function widget(id: string, chartType: string): WidgetInstance {
  return { id, chartType, title: id, chartQuery: {}, chartOptions: {} } as WidgetInstance;
}

describe('layoutScaffolds', () => {
  const preset: LayoutPreset = {
    id: 'kpi-row',
    nameKey: 'preset_kpi_row',
    layout: [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 3, h: 3 },
      { x: 9, y: 0, w: 3, h: 3 },
      { x: 0, y: 3, w: 12, h: 6 },
    ],
  };

  it('repositions existing widgets and adds scaffold slots', () => {
    const ordered: LayoutItem[] = [{ i: 'w1', x: 0, y: 0, w: 4, h: 4 }];
    const widgets: WidgetInstance[] = [
      { id: 'w1', chartType: 'bar', title: 'Sales', chartQuery: {}, chartOptions: {} },
    ];

    const result = applyPresetWithScaffolds(preset, ordered, widgets);
    expect(result.nextLayout[0]).toMatchObject({ i: 'w1', x: 0, y: 3, w: 12, h: 6 });
    expect(result.newWidgets).toHaveLength(4);
    expect(result.newLayoutItems).toHaveLength(4);
    expect(isLayoutSlotWidget(result.newWidgets[0]!)).toBe(true);
  });

  it('places KPIs into kpi slots and charts into chart slots', () => {
    const ordered: LayoutItem[] = [
      { i: 'chart1', x: 0, y: 0, w: 6, h: 5 },
      { i: 'kpi1', x: 0, y: 5, w: 3, h: 3 },
      { i: 'kpi2', x: 3, y: 5, w: 3, h: 3 },
    ];
    const widgets: WidgetInstance[] = [
      { id: 'chart1', chartType: 'bar', title: 'Sales', chartQuery: {}, chartOptions: {} },
      { id: 'kpi1', chartType: 'stat', title: 'A', chartQuery: {}, chartOptions: {} },
      { id: 'kpi2', chartType: 'stat', title: 'B', chartQuery: {}, chartOptions: {} },
    ];

    const result = applyPresetWithScaffolds(preset, ordered, widgets);
    const byId = Object.fromEntries(result.nextLayout.map((l) => [l.i, l]));
    expect(byId.kpi1?.y).toBe(0);
    expect(byId.kpi1?.h).toBe(3);
    expect(byId.kpi2?.y).toBe(0);
    expect(byId.chart1).toMatchObject({ x: 0, y: 3, w: 12, h: 6 });
    expect(result.newWidgets).toHaveLength(2);
  });

  it('packs overflow widgets below the preset instead of leaving old coords', () => {
    const ordered: LayoutItem[] = Array.from({ length: 7 }, (_, i) => ({
      i: `w${i}`,
      x: i,
      y: i,
      w: 4,
      h: 4,
    }));
    const widgets: WidgetInstance[] = ordered.map((l, i) => ({
      id: l.i,
      chartType: i < 4 ? 'stat' : 'bar',
      title: l.i,
      chartQuery: {},
      chartOptions: {},
    }));

    const result = applyPresetWithScaffolds(preset, ordered, widgets);
    expect(result.nextLayout).toHaveLength(7);
    expect(result.newWidgets).toHaveLength(0);
    const overflow = result.nextLayout.filter((l) => l.y >= 9);
    expect(overflow.length).toBe(2);
  });

  it('ranks stat widgets ahead of charts for kpi slots', () => {
    const kpi = { id: 'a', chartType: 'stat', title: '', chartQuery: {}, chartOptions: {} } as WidgetInstance;
    const bar = { id: 'b', chartType: 'bar', title: '', chartQuery: {}, chartOptions: {} } as WidgetInstance;
    expect(rankWidgetForSlot(kpi, 'kpi')).toBeLessThan(rankWidgetForSlot(bar, 'kpi'));
    expect(rankWidgetForSlot(bar, 'chart')).toBeLessThan(rankWidgetForSlot(kpi, 'chart'));
  });

  describe('suggestLayoutPreset', () => {
    it('returns null for an empty dashboard', () => {
      expect(suggestLayoutPreset([])).toBeNull();
    });

    it('recommends kpi-row for 4 KPIs + 1 chart (exact slot match, no scaffolds/overflow)', () => {
      const widgets = [
        widget('k1', 'stat'),
        widget('k2', 'stat'),
        widget('k3', 'stat'),
        widget('k4', 'stat'),
        widget('c1', 'bar'),
      ];
      // kpi-row = 4 kpi slots + 1 big chart slot -> exact fit; executive's
      // 2 chart slots would leave one empty (scaffold penalty), so kpi-row
      // must win even though executive also has 4 kpi slots.
      expect(suggestLayoutPreset(widgets)?.id).toBe('kpi-row');
    });

    it('recommends full-table for a single table-heavy dashboard', () => {
      expect(suggestLayoutPreset([widget('t1', 'table')])?.id).toBe('full-table');
    });

    it('prefers a preset with enough capacity over one that overflows', () => {
      const widgets = Array.from({ length: 4 }, (_, i) => widget(`c${i}`, 'bar'));
      const best = suggestLayoutPreset(widgets, [
        { id: 'two-col', nameKey: 'preset_two_col', layout: [
          { x: 0, y: 0, w: 6, h: 5 }, { x: 6, y: 0, w: 6, h: 5 },
          { x: 0, y: 5, w: 6, h: 5 }, { x: 6, y: 5, w: 6, h: 5 },
        ] },
        { id: 'single', nameKey: 'preset_report', layout: [{ x: 0, y: 0, w: 12, h: 5 }] },
      ]);
      // 4 charts fit exactly into two-col's 4 slots; cramming them into
      // "single"'s 1 slot means 3 must overflow — two-col must win.
      expect(best?.id).toBe('two-col');
    });
  });
});
