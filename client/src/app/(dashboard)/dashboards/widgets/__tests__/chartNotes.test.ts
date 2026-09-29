import { describe, expect, it } from 'vitest';
import { buildChartOptions } from '../ChartOptionsBuilder';

const x = ['A', 'B', 'C'];
const data = { x, y: [5, 9, 3], series: [{ name: 'Total', data: [5, 9, 3] }] } as any;

describe('annotations', () => {
  it('pin a note to a category at its value', () => {
    const o = buildChartOptions('bar', data, { annotations: [{ kind: 'note', category: 'B', text: 'Promo week' }] } as any);
    const note = o.series[0].markPoint.data[0];
    expect(note.coord).toEqual(['B', 9]);
    expect(note.label.formatter).toBe('Promo week');
  });

  it('shade a range between two categories, sideways on horizontal bars', () => {
    const o = buildChartOptions('bar', data, {
      barChartType: 'horizontal',
      annotations: [{ kind: 'highlight', from: 'A', to: 'B', text: 'Launch' }],
    } as any);
    const band = o.series[0].markArea.data[0];
    expect(band[0]).toMatchObject({ yAxis: 'A', name: 'Launch' });
    expect(band[1]).toEqual({ yAxis: 'B' });
  });

  it('skip notes for categories no longer in the data', () => {
    const o = buildChartOptions('bar', data, { annotations: [{ kind: 'note', category: 'Z', text: 'gone' }] } as any);
    expect(o.series[0].markPoint?.data?.length ?? 0).toBe(0);
  });
});
