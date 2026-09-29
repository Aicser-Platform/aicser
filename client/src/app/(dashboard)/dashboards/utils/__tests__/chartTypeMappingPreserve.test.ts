import { describe, expect, it } from 'vitest';
import { preserveChartQueryOnTypeChange } from '../chartTypeMappingPreserve';
import type { WidgetInstance } from '../../stores/dashboardStoreTypes';

function widget(chartType: string, chartQuery: Record<string, unknown>): WidgetInstance {
  return { id: 'w1', title: 'Widget', chartType, chartQuery } as unknown as WidgetInstance;
}

describe('preserveChartQueryOnTypeChange', () => {
  it('never sets groupBy when switching to pie/donut (dead field - schema key is x, and groupBy is typed as a boolean flag elsewhere, not a dimension)', () => {
    const w = widget('bar', { x: 'region', yMetrics: [{ field: 'revenue', aggregation: 'sum' }] });
    const result = preserveChartQueryOnTypeChange(w, 'pie');
    expect(result.groupBy).toBeUndefined();
    expect(result.x).toBe('region'); // untouched - already the field pie's own "Slice by" (x) reads
  });

  it('trims yMetrics to 1 when switching to a single-metric type (stat)', () => {
    const w = widget('bar', {
      x: 'region',
      yMetrics: [
        { field: 'revenue', aggregation: 'sum' },
        { field: 'cost', aggregation: 'sum' },
      ],
    });
    const result = preserveChartQueryOnTypeChange(w, 'stat');
    expect((result.yMetrics as unknown[]).length).toBe(1);
  });

  it('drops the secondary axis when leaving bar/line/area', () => {
    const w = widget('bar', {
      x: 'region',
      yMetrics: [{ field: 'revenue', aggregation: 'sum' }],
      yMetricsSecondary: [{ field: 'orders', aggregation: 'sum' }],
    });
    const result = preserveChartQueryOnTypeChange(w, 'pie');
    expect(result.yMetricsSecondary).toEqual([]);
  });

  it('seeds xMetrics from x when entering scatter for the first time', () => {
    const w = widget('bar', { x: 'spend', yMetrics: [{ field: 'revenue', aggregation: 'sum' }] });
    const result = preserveChartQueryOnTypeChange(w, 'scatter');
    expect(result.xMetrics).toEqual([{ field: 'spend', aggregation: 'none' }]);
  });

  it('does not seed a heatmap groupField out of thin air - leaves it for the setup-status check to flag', () => {
    const w = widget('bar', { x: 'region', yMetrics: [{ field: 'revenue', aggregation: 'sum' }] });
    const result = preserveChartQueryOnTypeChange(w, 'heatmap');
    expect(result.groupField).toBeUndefined();
  });
});

describe('pie automatic sort', () => {
  const bar = (q: Record<string, unknown>) => ({ id: 'w', chartType: 'bar', chartQuery: q }) as any;
  const pie = (q: Record<string, unknown>) => ({ id: 'w', chartType: 'pie', chartQuery: q }) as any;

  it('is undone when the chart leaves pie, so dates read in order again', () => {
    const toPie = preserveChartQueryOnTypeChange(bar({ x: 'order_date' }), 'pie');
    expect(toPie).toMatchObject({ sortBy: 'y', sortOrder: 'desc', sortAuto: true });
    const back = preserveChartQueryOnTypeChange(pie(toPie), 'bar');
    expect(back.sortBy).toBeUndefined();
    expect(back.sortOrder).toBeUndefined();
  });

  it('keeps a sort the person chose', () => {
    const back = preserveChartQueryOnTypeChange(pie({ x: 'region', sortBy: 'y', sortOrder: 'asc' }), 'bar');
    expect(back).toMatchObject({ sortBy: 'y', sortOrder: 'asc' });
  });
});
