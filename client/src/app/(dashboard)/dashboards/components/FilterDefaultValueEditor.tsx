'use client';

import React from 'react';
import { DatePicker, Input, InputNumber, Select } from 'antd';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';

type Props = {
  filter: DashboardFilter;
  onChange: (defaultValue: unknown) => void;
};

export function FilterDefaultValueEditor({ filter, onChange }: Props) {
  const t = useTranslations('dashboards');

  if (filter.type === 'dateRange') {
    const range =
      Array.isArray(filter.defaultValue) && filter.defaultValue.length >= 2
        ? (filter.defaultValue as [string, string])
        : null;
    return (
      <DatePicker.RangePicker
        size="small"
        style={{ width: 220 }}
        value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
        onChange={(_, strings) => {
          const [from, to] = strings;
          if (!from && !to) onChange(undefined);
          else onChange([from || '', to || '']);
        }}
        placeholder={[t('filter_default_from'), t('filter_default_to')]}
      />
    );
  }

  if (filter.type === 'date') {
    const val =
      typeof filter.defaultValue === 'string' && filter.defaultValue
        ? filter.defaultValue
        : null;
    return (
      <DatePicker
        size="small"
        style={{ width: 140 }}
        value={val ? dayjs(val) : null}
        onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : undefined)}
      />
    );
  }

  if (filter.type === 'slider') {
    const range =
      Array.isArray(filter.defaultValue) && filter.defaultValue.length >= 2
        ? (filter.defaultValue as [number, number])
        : [filter.numericMin ?? 0, filter.numericMax ?? 100];
    return (
      <Input.Group compact style={{ display: 'flex', width: 160 }}>
        <InputNumber
          size="small"
          style={{ width: '50%' }}
          placeholder={t('filter_slider_min')}
          value={range[0]}
          onChange={(v) => onChange([v ?? 0, range[1]])}
        />
        <InputNumber
          size="small"
          style={{ width: '50%' }}
          placeholder={t('filter_slider_max')}
          value={range[1]}
          onChange={(v) => onChange([range[0], v ?? 100])}
        />
      </Input.Group>
    );
  }

  if (filter.type === 'checkbox') {
    const raw = Array.isArray(filter.defaultValue)
      ? (filter.defaultValue as string[]).join(', ')
      : filter.defaultValue != null
        ? String(filter.defaultValue)
        : '';
    return (
      <Input
        size="small"
        style={{ width: 140 }}
        placeholder={t('filter_default_multi_hint')}
        value={raw}
        onChange={(e) => {
          const parts = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parts.length ? parts : undefined);
        }}
      />
    );
  }

  return (
    <Input
      size="small"
      style={{ width: 120 }}
      placeholder={t('filter_default_placeholder')}
      value={filter.defaultValue != null ? String(filter.defaultValue) : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
}
