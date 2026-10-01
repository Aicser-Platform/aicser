'use client';

import React, { useEffect, useMemo } from 'react';
import { DatePicker, Select, Space, TimePicker, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useFormatter, useTranslations } from 'next-intl';

const { Text } = Typography;

export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly';

/**
 * The next time a schedule fires, from now: today or tomorrow at the time (daily), the coming
 * weekday (weekly), the coming day of the month (monthly). A one-off keeps its own date.
 */
export function nextOccurrence(frequency: string, from: Dayjs, now: Dayjs = dayjs()): Dayjs {
  const at = (d: Dayjs) => d.hour(from.hour()).minute(from.minute()).second(0).millisecond(0);
  if (frequency === 'daily') {
    const d = at(now);
    return d.isAfter(now) ? d : d.add(1, 'day');
  }
  if (frequency === 'weekly') {
    let d = at(now.day(from.day()));
    while (!d.isAfter(now)) d = d.add(7, 'day');
    return d;
  }
  if (frequency === 'monthly') {
    const day = Math.min(from.date(), 28);
    let d = at(now.date(day));
    while (!d.isAfter(now)) d = d.add(1, 'month').date(day);
    return d;
  }
  return from;
}

/**
 * Asks only what the frequency needs: a time for "every day", a weekday and time for "every
 * week", a day of the month and time for "every month", a date and time for "once". The value
 * is always the next send, so callers can keep deriving time/weekday/day from one Dayjs.
 */
export function ScheduleWhen({
  frequency,
  value,
  onChange,
}: {
  frequency: string;
  value?: Dayjs | null;
  onChange?: (v: Dayjs) => void;
}) {
  const t = useTranslations('guided_schedule');
  const format = useFormatter();
  const current = value ? dayjs(value) : nextOccurrence('daily', dayjs().hour(8).minute(0));

  // A change of frequency moves the next send to match it (e.g. weekly -> the coming weekday).
  useEffect(() => {
    if (!onChange) return;
    const next = nextOccurrence(frequency, current);
    if (!value || !next.isSame(dayjs(value))) onChange(next);
    // Only when the frequency changes; value edits already arrive normalised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency]);

  const set = (d: Dayjs) => onChange?.(nextOccurrence(frequency, d));

  const weekdays = useMemo(
    () => [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      value: d,
      // 2024-01-07 is a Sunday, so 7 + d is that weekday.
      label: format.dateTime(new Date(Date.UTC(2024, 0, 7 + d)), { weekday: 'long', timeZone: 'UTC' }),
    })),
    [format]
  );
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: t('day_n', { n: i + 1 }) })), [t]);

  let zone = 'UTC';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // keep UTC
  }

  const time = (
    <TimePicker
      format="HH:mm"
      minuteStep={5}
      allowClear={false}
      needConfirm={false}
      value={current}
      onChange={(v) => v && set(current.hour(v.hour()).minute(v.minute()))}
      aria-label={t('time')}
      style={{ width: 110 }}
    />
  );

  return (
    <Space direction="vertical" size={4}>
      <Space wrap>
        {frequency === 'once' ? (
          <DatePicker
            showTime={{ format: 'HH:mm', minuteStep: 5 }}
            format="YYYY-MM-DD HH:mm"
            allowClear={false}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
            value={current}
            onChange={(v) => v && onChange?.(v)}
            aria-label={t('date_time')}
          />
        ) : (
          <>
            {frequency === 'weekly' ? (
              <Select value={current.day()} options={weekdays} onChange={(d: number) => set(current.day(d))}
                aria-label={t('weekday')} style={{ width: 150 }} />
            ) : null}
            {frequency === 'monthly' ? (
              <Select value={Math.min(current.date(), 28)} options={days} onChange={(d: number) => set(current.date(d))}
                aria-label={t('day_of_month')} style={{ width: 110 }} />
            ) : null}
            {time}
          </>
        )}
      </Space>
      <Text type="secondary" className="guided-form__hint">
        {t('first_send', { when: format.dateTime(current.toDate(), { dateStyle: 'medium', timeStyle: 'short' }), zone: zone.replace(/_/g, ' ') })}
      </Text>
    </Space>
  );
}
