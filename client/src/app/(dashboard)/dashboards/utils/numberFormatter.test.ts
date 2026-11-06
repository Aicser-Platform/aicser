import { describe, expect, it } from 'vitest';
import { formatNumber, formatStatValue } from './numberFormatter';

describe('formatNumber percent', () => {
  it('scales unit-interval ratios by 100', () => {
    expect(formatNumber(0.1234, { percent: true, decimals: 1, compact: false })).toBe('12.3%');
  });

  it('does not re-scale values already on a percent scale', () => {
    expect(formatNumber(12.3, { percent: true, decimals: 1, compact: false })).toBe('12.3%');
  });

  it('uses compact notation for large percent values when compact=true', () => {
    expect(formatNumber(786620, { percent: true, decimals: 2, compact: true })).toBe('786.62k%');
  });
});

describe('formatStatValue', () => {
  it('formats KPI percent without compact by default', () => {
    expect(formatStatValue(0.25, 'percent')).toBe('25.0%');
    expect(formatStatValue(25, 'percent')).toBe('25.0%');
  });

  it('shows a whole figure exactly, and shortens only the big ones', () => {
    expect(formatStatValue(1200)).toBe('1,200');
    expect(formatStatValue('1200', 'number')).toBe('1,200');
    expect(formatStatValue(12345, 'currency', '$')).toBe('$12,345');
    expect(formatStatValue(-1500, 'number', undefined, ' kg')).toBe('-1,500 kg');
    expect(formatStatValue(2_500_000)).toBe('2.50M');
    expect(formatStatValue(1234.56)).toBe('1.23k');
  });
});
