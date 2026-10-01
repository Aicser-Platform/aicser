import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { nextOccurrence } from '@/components/guided/ScheduleWhen';

// Wednesday 2026-09-30 10:00 local
const NOW = dayjs('2026-09-30T10:00:00');

describe('nextOccurrence', () => {
  it('daily: later today when the time is still ahead, otherwise tomorrow', () => {
    expect(nextOccurrence('daily', NOW.hour(14).minute(30), NOW).format('YYYY-MM-DD HH:mm')).toBe('2026-09-30 14:30');
    expect(nextOccurrence('daily', NOW.hour(8).minute(0), NOW).format('YYYY-MM-DD HH:mm')).toBe('2026-10-01 08:00');
  });

  it('weekly: the coming chosen weekday', () => {
    const monday = dayjs('2026-09-28T08:00:00'); // a Monday
    expect(nextOccurrence('weekly', monday, NOW).format('YYYY-MM-DD HH:mm ddd')).toBe('2026-10-05 08:00 Mon');
    const wednesdayLater = NOW.hour(18).minute(0);
    expect(nextOccurrence('weekly', wednesdayLater, NOW).format('YYYY-MM-DD HH:mm')).toBe('2026-09-30 18:00');
  });

  it('monthly: the coming chosen day, capped at the 28th', () => {
    expect(nextOccurrence('monthly', dayjs('2026-09-01T08:00:00'), NOW).format('YYYY-MM-DD HH:mm')).toBe('2026-10-01 08:00');
    expect(nextOccurrence('monthly', dayjs('2026-01-31T08:00:00'), NOW).format('YYYY-MM-DD')).toBe('2026-10-28');
  });

  it('once: keeps its own date', () => {
    const at = dayjs('2026-12-24T09:00:00');
    expect(nextOccurrence('once', at, NOW).isSame(at)).toBe(true);
  });
});
