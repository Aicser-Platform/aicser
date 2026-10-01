import { describe, expect, it } from 'vitest';
import { formatAxisLabel, makeCategoryLabelFormatter } from '../numberFormatter';

describe('axis labels', () => {
  it('keeps enough decimals for small values', () => {
    expect(formatAxisLabel(0.105)).not.toBe(formatAxisLabel(0.11));
    expect(formatAxisLabel(1_500_000)).toMatch(/1\.5\s?M/i);
  });

  it('formats date buckets by their real grain', () => {
    const months = ['2024-01-01T00:00:00', '2024-02-01T00:00:00'];
    expect(makeCategoryLabelFormatter(months, 'en-US')(months[0])).toBe('Jan 2024');
    const years = ['2023-01-01', '2024-01-01'];
    expect(makeCategoryLabelFormatter(years, 'en-US')(years[1])).toBe('2024');
    const days = ['2024-01-05', '2024-01-06'];
    expect(makeCategoryLabelFormatter(days, 'en-US')(days[0])).toBe('Jan 5, 2024');
  });

  it('leaves categories alone', () => {
    expect(makeCategoryLabelFormatter(['Branch 1', '2024-01-01'])('Branch 1')).toBe('Branch 1');
  });
});

describe('boolean categories', () => {
  it('reads a true/false column as Yes / No', () => {
    const fmt = makeCategoryLabelFormatter(['false', 'true'], 'en-US', { yes: 'Yes', no: 'No' });
    expect(fmt('true')).toBe('Yes');
    expect(fmt(false)).toBe('No');
  });

  it('leaves mixed columns alone', () => {
    const fmt = makeCategoryLabelFormatter(['true', 'maybe'], 'en-US', { yes: 'Yes', no: 'No' });
    expect(fmt('true')).toBe('true');
  });
});

describe('date columns with blanks', () => {
  it('still formats dates when a bucket is empty', () => {
    const fmt = makeCategoryLabelFormatter(['2024-01-01T00:00:00', null, '2024-01-08T00:00:00'], 'en-US');
    expect(fmt('2024-01-08T00:00:00')).toBe('Jan 8, 2024');
  });
});
