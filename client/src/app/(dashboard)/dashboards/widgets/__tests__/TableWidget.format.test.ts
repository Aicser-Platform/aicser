import { describe, expect, it } from 'vitest';
import { tableValueFormat } from '../TableWidget';

describe('tableValueFormat', () => {
  it('maps currency metricFormats to currency', () => {
    expect(tableValueFormat('Sum of revenue', { 'Sum of revenue': 'currency' })).toBe('currency');
  });

  it('maps percent metricFormats to percent', () => {
    expect(tableValueFormat('conversion_rate', { conversion_rate: 'percent' })).toBe('percent');
  });

  it('falls back to number when no format is configured for the field', () => {
    expect(tableValueFormat('order_count', {})).toBe('number');
    expect(tableValueFormat('order_count', undefined)).toBe('number');
  });

  it('falls back to number for auto/compact/full (table has no separate compact/full rendering)', () => {
    expect(tableValueFormat('x', { x: 'auto' })).toBe('number');
    expect(tableValueFormat('x', { x: 'compact' })).toBe('number');
    expect(tableValueFormat('x', { x: 'full' })).toBe('number');
  });
});
