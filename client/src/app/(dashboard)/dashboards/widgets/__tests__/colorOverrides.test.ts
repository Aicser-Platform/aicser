import { describe, expect, it } from 'vitest';
import { applyColorOverrides } from '../colorOverrides';

describe('picked colours', () => {
  it('colour one series on a multi-series chart', () => {
    const out = applyColorOverrides(
      { xAxis: { type: 'category', data: ['Q1'] }, series: [{ name: 'North', type: 'line', data: [1] }, { name: 'South', type: 'line', data: [2] }] },
      { South: '#ff0000' },
    );
    expect(out.series[1].itemStyle.color).toBe('#ff0000');
    expect(out.series[1].lineStyle.color).toBe('#ff0000');
    expect(out.series[0].itemStyle).toBeUndefined();
  });

  it('colour one bar when each bar has its own colour', () => {
    const out = applyColorOverrides(
      { yAxis: { type: 'category', data: ['A', 'B'] }, series: [{ name: 'Total', type: 'bar', colorBy: 'data', data: [3, 4] }] },
      { B: '#00ff00' },
    );
    expect(out.series[0].data).toEqual([3, { value: 4, itemStyle: { color: '#00ff00' } }]);
  });

  it('colour one slice by its raw value', () => {
    const out = applyColorOverrides(
      { series: [{ type: 'pie', data: [{ name: 'Jun 2024', raw: '2024-06-01T00:00:00', value: 5 }] }] },
      { '2024-06-01T00:00:00': '#123456' },
    );
    expect(out.series[0].data[0].itemStyle.color).toBe('#123456');
  });
});
