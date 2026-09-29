import { describe, expect, it } from 'vitest';
import { axisTitleGap, formatByValueFormat, getYAxisConfig } from '../WidgetRendererConfig';
import { currencySymbolFor } from '../../Properties/CurrencySymbolField';

describe('axis titles', () => {
  const base = { fontSize: 11, labelMargin: 12, rotate: 0 };

  it('sit beyond the widest label, and close in when labels are hidden', () => {
    const narrow = axisTitleGap({ ...base, labelsShown: true, labels: ['35k'], vertical: true });
    const wide = axisTitleGap({ ...base, labelsShown: true, labels: ['$1,250,000'], vertical: true });
    expect(wide).toBeGreaterThan(narrow);
    expect(axisTitleGap({ ...base, labelsShown: false, labels: ['$1,250,000'], vertical: true })).toBe(12);
  });

  it('make room for slanted category labels', () => {
    const level = axisTitleGap({ ...base, labelsShown: true, labels: ['September 2024'], vertical: false });
    const slanted = axisTitleGap({ ...base, labelsShown: true, labels: ['September 2024'], vertical: false, rotate: 45 });
    expect(slanted).toBeGreaterThan(level);
  });

  it('follows the data on a real Y axis', () => {
    const small = getYAxisConfig({ yAxisLabel: 'Sales' } as any, { x: [], y: [], series: [{ name: 's', data: [5, 9] }] });
    const big = getYAxisConfig({ yAxisLabel: 'Sales' } as any, { x: [], y: [], series: [{ name: 's', data: [5, 1_250_000] }] });
    expect(big.nameGap).toBeGreaterThan(small.nameGap);
  });
});

describe('currency', () => {
  it('uses the chosen symbol, "$" when none', () => {
    expect(formatByValueFormat(1500, 'currency', '€')).toBe('€1.5k');
    expect(formatByValueFormat(1500, 'currency')).toBe('$1.5k');
  });

  it('writes each currency unambiguously', () => {
    expect(currencySymbolFor('EUR')).toBe('€');
    expect(currencySymbolFor('AUD')).toBe('A$');
    expect(currencySymbolFor('CHF')).toBe('CHF ');
  });
});
