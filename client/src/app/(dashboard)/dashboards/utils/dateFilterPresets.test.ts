import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { detectDatePresetKey, presetRangeByKey } from './dateFilterPresets';

describe('dateFilterPresets', () => {
  it('detects today preset', () => {
    const from = dayjs().startOf('day').format('YYYY-MM-DD');
    const to = dayjs().endOf('day').format('YYYY-MM-DD');
    expect(detectDatePresetKey(from, to)).toBe('today');
  });

  it('returns custom for non-matching ranges', () => {
    expect(detectDatePresetKey('2000-01-01', '2000-01-31')).toBe('custom');
  });

  it('returns null when empty', () => {
    expect(detectDatePresetKey(null, null)).toBeNull();
  });

  it('mtd and thisMonth end at today', () => {
    const today = dayjs().format('YYYY-MM-DD');
    expect(presetRangeByKey('mtd').to).toBe(today);
    expect(presetRangeByKey('thisMonth').to).toBe(today);
    expect(presetRangeByKey('qtd').to).toBe(today);
    expect(presetRangeByKey('thisQtr').to).toBe(today);
  });
});
