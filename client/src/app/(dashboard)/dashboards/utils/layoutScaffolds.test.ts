import { describe, expect, it } from 'vitest';
import { applyPresetWithScaffolds, isLayoutSlotWidget } from './layoutScaffolds';
import type { LayoutPreset } from '../components/LayoutPresetsMenu';
import type { LayoutItem } from '../stores/useDashboardStore';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

describe('layoutScaffolds', () => {
  const preset: LayoutPreset = {
    id: 'kpi-row',
    name: 'KPI row',
    layout: [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 6, h: 8 },
    ],
  };

  it('repositions existing widgets and adds scaffold slots', () => {
    const ordered: LayoutItem[] = [{ i: 'w1', x: 0, y: 0, w: 4, h: 4 }];
    const widgets: WidgetInstance[] = [
      { id: 'w1', chartType: 'bar', title: 'Sales', chartQuery: {}, chartOptions: {} },
    ];

    const result = applyPresetWithScaffolds(preset, ordered, widgets);
    expect(result.nextLayout[0]).toMatchObject({ i: 'w1', x: 0, y: 0, w: 3, h: 3 });
    expect(result.newWidgets).toHaveLength(2);
    expect(result.newLayoutItems).toHaveLength(2);
    expect(isLayoutSlotWidget(result.newWidgets[0])).toBe(true);
  });
});
