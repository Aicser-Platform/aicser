import { describe, expect, it } from 'vitest';
import {
  applyPresetWithScaffolds,
  isLayoutSlotWidget,
  rankWidgetForSlot,
} from './layoutScaffolds';
import type { LayoutPreset } from '../components/LayoutPresetsMenu';
import type { LayoutItem } from '../stores/useDashboardStore';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

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
});
