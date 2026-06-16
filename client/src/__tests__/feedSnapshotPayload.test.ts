import { describe, expect, it } from 'vitest';
import type { LayoutItem, WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import {
  buildDashboardSnapshotPayload,
  snapshotWidgetsFromPayload,
} from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';

describe('buildDashboardSnapshotPayload', () => {
  it('captures featured widgets and dashboard palette from store state', () => {
    const widgets: WidgetInstance[] = [
      { id: 'text', title: 'Context', chartType: 'text', chartOptions: {} },
      { id: 'stat', title: 'Revenue', chartType: 'stat', chartData: { x: ['Revenue'], y: [42] } },
      { id: 'line', title: 'Trend', chartType: 'line', chartData: { x: ['Jan'], y: [42] } },
      { id: 'table', title: 'Details', chartType: 'table', chartData: { x: ['Region'], y: ['APAC'] } },
      { id: 'bar', title: 'Regions', chartType: 'bar', chartData: { x: ['APAC'], y: [18] } },
      { id: 'pie', title: 'Portfolio', chartType: 'pie', chartData: { x: ['Active'], y: [72] } },
    ];
    const layout: LayoutItem[] = widgets.map((widget, index) => ({
      i: widget.id,
      x: (index % 2) * 6,
      y: Math.floor(index / 2) * 4,
      w: 6,
      h: 4,
    }));

    const payload = buildDashboardSnapshotPayload({
      dashboardId: 'dashboard-1',
      title: 'Executive overview',
      widgets,
      layout,
      colorPalette: 'ocean',
    });
    const hydrated = snapshotWidgetsFromPayload(payload);

    expect(payload.visuals.presentation?.featuredWidgetIds).toHaveLength(6);
    expect(payload.visuals.presentation?.featuredWidgetIds).toContain('stat');
    expect(payload.visuals.presentation?.featuredWidgetIds).toContain('line');
    expect(hydrated.find((widget) => widget.id === 'stat')?.chartOptions).toMatchObject({
      colorPalette: 'ocean',
      dashboardDefaultPalette: 'ocean',
    });
  });
});
