import { describe, expect, it } from 'vitest';
import { buildChartOptions } from '../ChartOptionsBuilder';
import { getBaseLegendConfig, legendPlacement } from '../WidgetRendererConfig';

const x = ['2024-01-01T00:00:00', '2024-02-01T00:00:00'];
const data = { x, y: [10, 20], series: [{ name: 'Total', data: [10, 20] }] } as any;
const axis = (o: any, k: 'xAxis' | 'yAxis') => (Array.isArray(o[k]) ? o[k][0] : o[k]);

describe('horizontal bars', () => {
  const o = buildChartOptions('bar', data, { barChartType: 'horizontal', showDataLabel: true } as any);

  it('name dates on the category axis', () => {
    expect(axis(o, 'yAxis').axisLabel.formatter(x[0])).toBe('Jan 2024');
  });

  it('print values past the bar end by default, not inside it', () => {
    expect(o.series[0].label.position).toBe('right');
  });

  it('title the tooltip with the formatted category', () => {
    const html = o.tooltip.formatter([{ name: x[1], value: 20, seriesName: 'Total', marker: '' }]);
    expect(html).toContain('Feb 2024');
    expect(html).not.toContain('T00:00');
  });
});

describe('data label position', () => {
  it('follows the choice on bars and lines', () => {
    const inside = buildChartOptions('bar', data, { showDataLabel: true, dataLabelPosition: 'inside' } as any);
    expect(inside.series[0].label.position).toBe('insideTop');
    const below = buildChartOptions('line', data, { showDataLabel: true, dataLabelPosition: 'below' } as any);
    expect(below.series[0].label.position).toBe('bottom');
  });
});

describe('legend placement', () => {
  it('covers corners and sides; old values keep their spot', () => {
    expect(legendPlacement('top')).toEqual({ side: 'top', align: 'start' });
    expect(getBaseLegendConfig(true, 'bar', { legendPosition: 'bottom-right' } as any)).toMatchObject({ bottom: 5, right: 10 });
    expect(getBaseLegendConfig(true, 'bar', { legendPosition: 'middle-left' } as any)).toMatchObject({ left: 5, top: 'middle', orient: 'vertical' });
  });
});

describe('x label angle', () => {
  it('uses any degree the author sets', () => {
    const o = buildChartOptions('bar', data, { hAxisLabelRotate: 30 } as any);
    expect(axis(o, 'xAxis').axisLabel.rotate).toBe(30);
  });
});

describe('log scale', () => {
  it('never applies to bars', () => {
    const o = buildChartOptions('bar', data, { design: { axis: { yScale: 'log' } } } as any);
    expect(axis(o, 'yAxis').type).toBe('value');
  });
});

describe('value axis range', () => {
  it('sets start and end on the value axis, X for horizontal bars', () => {
    const v = buildChartOptions('bar', data, { valueAxisMin: 0, valueAxisMax: 50 } as any);
    expect(axis(v, 'yAxis')).toMatchObject({ min: 0, max: 50 });
    const h = buildChartOptions('bar', data, { barChartType: 'horizontal', valueAxisMax: 50 } as any);
    expect(axis(h, 'xAxis').max).toBe(50);
  });
});

describe('pie label contents', () => {
  it('shows the parts the author picked', async () => {
    const { sliceLabel } = await import('../ChartSeriesBuilder');
    expect(sliceLabel({} as any, 'North', '$1.2k', '40.0')).toBe('North: $1.2k (40.0%)');
    expect(sliceLabel({ pieLabelParts: ['percent'] } as any, 'North', '$1.2k', '40.0')).toBe('40.0%');
    expect(sliceLabel({ pieLabelParts: ['name', 'percent'] } as any, 'North', '$1.2k', '40.0')).toBe('North: 40.0%');
  });
});

describe('text styles', () => {
  it('apply font, size and color to axes, legend and labels; per-element wins', () => {
    const o = buildChartOptions('bar', data, {
      showDataLabel: true,
      showLegend: true,
      textFont: 'serif',
      textSize: 'large',
      textColor: '#333333',
      dataLabelColor: '#ff0000',
    } as any);
    expect(o.textStyle.fontFamily).toContain('Georgia');
    expect(axis(o, 'xAxis').axisLabel.color).toBe('#333333');
    expect(o.series[0].label.color).toBe('#ff0000');
    expect(o.legend.textStyle.color).toBe('#333333');
  });
});

describe('outside bar labels', () => {
  it('keep a readable text color and no white outline', () => {
    const o = buildChartOptions('bar', data, { showDataLabel: true, dataLabelPosition: 'end' } as any);
    expect(o.series[0].label.color).toBeTruthy();
    expect(o.series[0].label.color).not.toBe('#fff');
    expect(o.series[0].label.textBorderWidth).toBe(0);
  });
});
