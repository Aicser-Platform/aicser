import { hydrateRemixWidget, isRemixSnapshotWidget } from '@/app/(dashboard)/dashboards/utils/remixSnapshotHydration';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';

describe('remixSnapshotHydration', () => {
  it('hydrates widget from snapshotChartData', () => {
    const widget: WidgetInstance = {
      id: 'w1',
      title: 'Revenue',
      chartType: 'bar',
      chartOptions: {
        feedRemix: true,
        snapshotChartData: { x: ['A'], y: [1], series: [{ name: 'Rev', data: [1] }] },
      },
      isLoading: false,
      error: null,
    };
    const hydrated = hydrateRemixWidget(widget);
    expect(hydrated.chartData).toBeDefined();
    expect(hydrated.error).toBeNull();
    expect(isRemixSnapshotWidget(hydrated)).toBe(true);
  });

  it('passes through non-remix widgets', () => {
    const widget: WidgetInstance = {
      id: 'w2',
      title: 'Live',
      chartType: 'line',
      chartOptions: {},
      isLoading: false,
      error: null,
    };
    expect(hydrateRemixWidget(widget)).toEqual(widget);
    expect(isRemixSnapshotWidget(widget)).toBe(false);
  });
});
